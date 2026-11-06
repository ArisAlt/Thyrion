use crate::errors::{PlinkyError, Result};
use crate::session::flow::FlowGate;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

pub mod local;
pub mod plink;
pub mod serial;
pub mod tcp_state;
pub mod telnet;

/// Writes to a pty on a thread of its own, in order.
///
/// A pty write blocks while the child isn't reading: a paste into a busy
/// program fills the pty's input buffer, plink stops reading while its
/// network is slow, Windows' pseudo-console stalls. Transports are written
/// with the registry's sessions lock held, and every tab's output needs that
/// lock: one blocked write stopped output and input in every tab. Native
/// telnet and serial already wrote from their own threads.
///
/// Bytes are wiped once written: a vault password typed into the session
/// (`SessionRegistry::type_secret`) passes through here. Once a write fails
/// (the child is gone), every later one is refused.
///
/// At most `MAX_PENDING_INPUT` bytes wait. A blocking write used to hold
/// back whoever wrote; queued without a limit, a script feeding a session
/// that had stopped reading could fill memory. Past the limit a write is
/// refused with `InputBusy`; the script runner waits and tries again.
pub(crate) struct PtyWriter {
    tx: std::sync::mpsc::Sender<zeroize::Zeroizing<Vec<u8>>>,
    failed: Arc<AtomicBool>,
    pending: Arc<std::sync::atomic::AtomicUsize>,
}

/// Input waiting for one session: a few of the largest pastes (1 MiB,
/// session/paste.rs).
pub(crate) const MAX_PENDING_INPUT: usize = 4 * 1024 * 1024;

impl PtyWriter {
    pub(crate) fn spawn(mut writer: Box<dyn Write + Send>) -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<zeroize::Zeroizing<Vec<u8>>>();
        let failed = Arc::new(AtomicBool::new(false));
        let pending = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (failed_writer, pending_writer) = (failed.clone(), pending.clone());
        // Ends when the transport (and with it `tx`) is dropped.
        std::thread::spawn(move || {
            for data in rx {
                let ok = writer.write_all(&data).and_then(|_| writer.flush()).is_ok();
                pending_writer.fetch_sub(data.len(), Ordering::Relaxed);
                if !ok {
                    failed_writer.store(true, Ordering::Relaxed);
                    break;
                }
            }
        });
        Self { tx, failed, pending }
    }

    pub(crate) fn write(&self, data: &[u8]) -> Result<()> {
        if self.failed.load(Ordering::Relaxed) {
            return Err(PlinkyError::ProcessError("The session no longer takes input".into()));
        }
        let waiting = self.pending.fetch_add(data.len(), Ordering::Relaxed);
        if waiting > 0 && waiting + data.len() > MAX_PENDING_INPUT {
            self.pending.fetch_sub(data.len(), Ordering::Relaxed);
            return Err(PlinkyError::InputBusy(waiting / 1024));
        }
        self.tx.send(zeroize::Zeroizing::new(data.to_vec())).map_err(|_| {
            self.pending.fetch_sub(data.len(), Ordering::Relaxed);
            PlinkyError::ProcessError("The session no longer takes input".into())
        })
    }
}

/// Handle to a PTY child whose output is being pumped by [`pump_pty_child`].
pub(crate) struct PtyChild {
    pub killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    pub alive: Arc<AtomicBool>,
    output: Arc<Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>>,
    flow: Arc<FlowGate>,
}

impl PtyChild {
    /// Adds bytes to the session's output as if the child had written them:
    /// the echo plink leaves to its terminal (plink.rs, `LocalEcho`). Sent
    /// through the reader's own sender, so it lands in order with the
    /// child's output, and charged to the flow window like it.
    pub(crate) fn inject(&self, bytes: Vec<u8>) {
        if bytes.is_empty() {
            return;
        }
        let n = bytes.len();
        let guard = self.output.lock().unwrap();
        if let Some(tx) = guard.as_ref() {
            if tx.send(bytes).is_ok() {
                self.flow.charge(n);
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Forwards a PTY child's output to `out_tx` and ends the stream when the
/// child exits -- the session manager reports a closed stream as a closed
/// session.
///
/// Ending on EOF alone wasn't enough. On Windows, ConPTY keeps the output
/// pipe open after the child exits, so a dead shell, or an SSH session whose
/// plink had quit, stayed "live" forever. On Unix the same happens while
/// anything the shell started still holds the terminal. So a second thread
/// waits on the child itself; once it has exited and output has been quiet
/// for a moment (trailing output still drains), the stream is closed.
pub(crate) fn pump_pty_child(
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    out_tx: mpsc::UnboundedSender<Vec<u8>>,
    flow: Arc<FlowGate>,
) -> PtyChild {
    let killer = child.clone_killer();
    let alive = Arc::new(AtomicBool::new(true));
    let sender = Arc::new(Mutex::new(Some(out_tx)));
    let last_output = Arc::new(AtomicU64::new(now_ms()));

    let (reader_sender, reader_last, reader_flow) = (sender.clone(), last_output.clone(), flow.clone());
    let (sender_for_echo, flow_for_echo) = (sender.clone(), flow.clone());
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            // Don't read while the page is a full window behind (ADR-006):
            // the PTY buffer fills and plink slows down instead.
            reader_flow.wait_for_room();
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    reader_last.store(now_ms(), Ordering::Relaxed);
                    let guard = reader_sender.lock().unwrap();
                    match guard.as_ref() {
                        // Charged here, at the source: if the tasks between
                        // here and the page fall behind, the reader still
                        // stops at the window instead of racing ahead.
                        Some(tx) if tx.send(buf[..n].to_vec()).is_ok() => reader_flow.charge(n),
                        // Nobody is listening, but keep draining to EOF:
                        // Windows' ClosePseudoConsole waits for the output
                        // pipe to empty, and a reader that stopped here left
                        // closing the tab (or the app) hanging.
                        _ => {}
                    }
                }
            }
        }
        reader_sender.lock().unwrap().take();
    });

    let waiter_alive = alive.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        waiter_alive.store(false, Ordering::Relaxed);
        let deadline = now_ms() + 2000;
        while now_ms() < deadline && now_ms().saturating_sub(last_output.load(Ordering::Relaxed)) < 200 {
            std::thread::sleep(Duration::from_millis(50));
        }
        sender.lock().unwrap().take();
        // A reader waiting for room must not outlive the process.
        flow.close();
    });

    PtyChild { killer, alive, output: sender_for_echo, flow: flow_for_echo }
}

pub trait Transport: Send {
    /// Asserts (`true`) or releases (`false`) a line break condition. Only a
    /// serial line can do this; plink has no break interface (ADR-005).
    fn set_break(&mut self, _on: bool) -> Result<()> {
        Err(crate::errors::PlinkyError::ProcessError(
            "Send Break is only supported on serial sessions".into(),
        ))
    }

    /// Writes raw bytes (keystrokes, commands) directly into the PTY master.
    fn write(&mut self, data: &[u8]) -> Result<()>;

    /// Propagates terminal resize (columns, rows) to the underlying PTY.
    fn resize(&mut self, cols: u16, rows: u16) -> Result<()>;

    /// The process that makes the network connection, where there is one
    /// (plink). Used to see when its connection is up (tcp_state.rs).
    fn process_id(&self) -> Option<u32> {
        None
    }

    /// Whether the connection is up, for a transport that knows it
    /// directly (`None`: ask the system about `process_id`'s sockets).
    fn connected(&self) -> Option<bool> {
        None
    }

    /// The login is over: plink now reads the session as it runs, not
    /// line by line (see PlinkTransport::begun). Only plink cares.
    fn session_begun(&mut self) {}

    /// Whether `session_begun` has happened (always, where there's no login).
    fn has_begun(&self) -> bool {
        true
    }

    /// Whether a paced paste sends each line only once the device has
    /// echoed the one before (a serial line: see session/paste.rs).
    fn paste_waits_for_echo(&self) -> bool {
        false
    }

    /// Explicitly terminates the transport and child process.
    fn kill(&mut self) -> Result<()>;

    /// Checks if the underlying process is still running.
    fn is_alive(&mut self) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Condvar;

    type Gate = Arc<(Mutex<bool>, Condvar)>;

    /// A pty whose child stops reading until `release`.
    struct StuckPty {
        open: Gate,
        got: Arc<Mutex<Vec<u8>>>,
        fail: bool,
    }

    impl Write for StuckPty {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let (lock, cv) = &*self.open;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = cv.wait(open).unwrap();
            }
            if self.fail {
                return Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "child gone"));
            }
            self.got.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn stuck(fail: bool) -> (PtyWriter, Gate, Arc<Mutex<Vec<u8>>>) {
        let open = Arc::new((Mutex::new(false), Condvar::new()));
        let got = Arc::new(Mutex::new(Vec::new()));
        let w = PtyWriter::spawn(Box::new(StuckPty { open: open.clone(), got: got.clone(), fail }));
        (w, open, got)
    }

    fn release(open: &Gate) {
        *open.0.lock().unwrap() = true;
        open.1.notify_all();
    }

    #[test]
    fn a_child_that_stops_reading_does_not_hold_up_the_writer() {
        // The registry writes with every session's lock held: a write that
        // waited for the child here froze every tab.
        let (w, open, got) = stuck(false);
        let started = std::time::Instant::now();
        for _ in 0..1000 {
            w.write(b"show running-config\r").unwrap();
        }
        assert!(started.elapsed() < Duration::from_millis(500), "writes waited for the child");
        release(&open);
        let want = b"show running-config\r".repeat(1000);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().len() < want.len() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(*got.lock().unwrap(), want, "everything arrives, in order");
    }

    #[test]
    fn a_session_that_stops_reading_refuses_input_past_the_limit_then_takes_it_again() {
        // Queued without a limit, a script feeding a stuck session filled
        // memory.
        let (w, open, got) = stuck(false);
        let chunk = vec![b'x'; 64 * 1024];
        let mut queued = 0;
        let refused = loop {
            match w.write(&chunk) {
                Ok(()) => queued += chunk.len(),
                Err(e) => break e,
            }
            assert!(queued <= MAX_PENDING_INPUT, "queued past the limit");
        };
        assert!(matches!(refused, PlinkyError::InputBusy(_)), "{refused}");
        assert!(queued + chunk.len() > MAX_PENDING_INPUT);
        release(&open);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while w.write(&chunk).is_err() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(w.write(&chunk).is_ok(), "drained, it takes input again");
        while got.lock().unwrap().len() < queued && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(got.lock().unwrap().len() >= queued);
    }

    #[test]
    fn one_write_larger_than_the_limit_still_goes_through() {
        // A paste is capped at 1 MiB; anything larger is still sent when
        // nothing else is waiting, rather than refused for ever.
        let (w, open, _got) = stuck(false);
        assert!(w.write(&vec![b'y'; MAX_PENDING_INPUT + 1]).is_ok());
        release(&open);
    }

    #[test]
    fn once_a_write_fails_later_ones_are_refused() {
        let (w, open, _got) = stuck(true);
        w.write(b"a").unwrap();
        release(&open);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while w.write(b"b").is_ok() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(w.write(b"c").is_err());
    }
}
