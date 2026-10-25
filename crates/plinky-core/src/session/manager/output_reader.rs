//! What happens to a session's output on its way to the page.
//!
//! Every session has one reader task: it takes each chunk the transport
//! read, records it in the session (`take_in`), then hands the page what the
//! pre-auth state machine decided it may see (`deliver`). Sessions with a
//! login (plink) and sessions that start live (local shell, serial line,
//! telnet) go through the same steps; for the second kind the login-only
//! parts (jump-host login, jump script, plink's begin gate) never act.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

use super::{PromptEvent, SessionRegistry};
use crate::session::begin_gate::{BeginGate, Gate};
use crate::session::expect::Event;
use crate::session::flow::FlowGate;
use crate::session::state_machine::{CloseReason, PreAuthAction};

pub(super) type Subscriber = Arc<Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>>;

/// Sends a chunk's output to the page attached to a session, unless that
/// page already got the chunk in its attach replay. The reader puts a chunk
/// in scrollback under the sessions lock and sends it after releasing it; an
/// attach in between replayed the chunk, and sending it as well drew it
/// twice. `chunk_end` is where the chunk ends in scrollback.
pub(super) fn send_fresh(
    subscriber: &Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    replayed_to: &AtomicU64,
    chunk_end: u64,
    bytes: Vec<u8>,
) -> bool {
    let sub = subscriber.lock().unwrap();
    match sub.as_ref() {
        Some(tx) if chunk_end > replayed_to.load(Ordering::SeqCst) => tx.send(bytes).is_ok(),
        _ => false,
    }
}

/// What the terminal shows when the session ends on a Closed action.
fn closing_notice(reason: CloseReason) -> String {
    match reason {
        CloseReason::AuthFailed(err) => match err.find("FATAL ERROR:") {
            Some(pos) => format!("\r\n\x1b[31m{}\x1b[0m\r\n", err[pos..].trim()),
            None => format!("\r\n\x1b[31m[Thyrion: Session closed ({err})]\x1b[0m\r\n"),
        },
        CloseReason::HostKeyRejected => "\r\n\x1b[31m[Thyrion: Host key was rejected]\x1b[0m\r\n".to_string(),
        CloseReason::Error(err) => format!("\r\n\x1b[31m[Thyrion: Error: {err}]\x1b[0m\r\n"),
        CloseReason::Ok => "\r\n[Thyrion: Session closed]\r\n".to_string(),
    }
}

/// A chunk recorded in its session, and what to do with it next.
struct TakenIn {
    action: PreAuthAction,
    /// Where the chunk ends in scrollback (see `send_fresh`).
    chunk_end: u64,
    /// A jump script that stopped says why, in the terminal.
    note: Option<String>,
}

pub(super) struct OutputReader {
    pub registry: SessionRegistry,
    pub id: String,
    /// The session this reader belongs to: an id can be reused after a
    /// close, so the reader checks this before touching the map entry.
    pub instance: u64,
    pub subscriber: Subscriber,
    pub replayed_to: Arc<AtomicU64>,
    pub flow: Arc<FlowGate>,
    /// plink's "Press Return to begin session" after login, while it is
    /// still on its way (begin_gate.rs).
    pub begin_gate: Option<BeginGate>,
}

impl OutputReader {
    pub async fn run(mut self, mut raw_rx: mpsc::UnboundedReceiver<Vec<u8>>) {
        while let Some(chunk) = raw_rx.recv().await {
            // The session was closed or replaced: its end is accounted for.
            let Some(taken) = self.take_in(&chunk) else { return };
            if let Some(note) = taken.note {
                self.send(note.into_bytes());
            }
            // Charged by the transport when read; what doesn't reach the
            // page (a withheld prompt, a detached tab) is refunded here.
            let chunk_len = chunk.len();
            let Some(forwarded) = self.deliver(taken.action, chunk, taken.chunk_end) else {
                return; // the session ended, and said so
            };
            self.flow.ack(chunk_len.saturating_sub(forwarded) as u64);
        }
        // The stream ended with no Closed action: the process exited by itself.
        self.registry.report_process_exit(&self.id, self.instance, &self.subscriber);
    }

    /// Records a chunk in its session, under the sessions lock: scrollback,
    /// a script's tap, the paste echo, the log, the jump-host login, a jump
    /// script, the state machine and the logon actions. None once the
    /// session is gone.
    fn take_in(&self, chunk: &[u8]) -> Option<TakenIn> {
        let mut lock = self.registry.sessions.lock().unwrap();
        let session = lock.get_mut(&self.id).filter(|s| s.instance == self.instance)?;
        session.scrollback.push(chunk);
        let chunk_end = session.scrollback.total_bytes_written() as u64;
        session.feed_tap(chunk);
        session.echoes.saw(chunk);
        // PuTTY-style "all session output" logging. A log that can't be
        // written any more (disk full, drive gone) is closed, not retried per
        // chunk; the session carries on.
        if let Some(log) = session.log.as_mut() {
            if log.write(chunk).is_err() {
                session.log = None;
            }
        }
        // Pre-auth only: once Live, remote output can never draw a stored
        // password out of the vault.
        if session.state_machine.is_live() {
            session.jump_login = None;
        } else if let Some(answer) = session.jump_login.as_mut().and_then(|j| j.feed(chunk)) {
            let _ = session.transport.write(&answer);
        }
        let mut note = None;
        if let Some(script) = session.expect.as_mut() {
            match script.feed(chunk) {
                Event::Send { bytes, .. } => {
                    let _ = session.transport.write(&bytes);
                }
                Event::Stopped(why) => {
                    session.expect = None;
                    note = why.filter(|w| !w.is_empty()).map(|why| {
                        format!("\r\n\x1b[33m[Thyrion: jump script stopped ({why}). Carry on by hand.]\x1b[0m\r\n")
                    });
                }
                Event::None => {}
            }
            if session.expect.as_ref().is_some_and(|e| e.is_done()) {
                session.expect = None;
            }
        }
        let action = session.state_machine.feed_bytes(chunk);
        let locked = self.registry.is_input_locked(&self.id);
        session.run_logon(chunk, locked);
        Some(TakenIn { action, chunk_end, note })
    }

    /// Hands the page what the state machine decided it may see. Returns
    /// how many bytes reached the page, or None when the session ended.
    fn deliver(&mut self, action: PreAuthAction, chunk: Vec<u8>, chunk_end: u64) -> Option<usize> {
        let sent = |bytes: Vec<u8>| {
            let n = bytes.len();
            if send_fresh(&self.subscriber, &self.replayed_to, chunk_end, bytes) { n } else { 0 }
        };
        Some(match action {
            // Pre-auth bytes (a banner, the username and password prompts) are
            // shown so the user can answer them.
            PreAuthAction::Hold => sent(chunk),
            PreAuthAction::PassThrough(bytes) => {
                // Still watching for plink's begin prompt: on Windows its
                // line can arrive after the marker's chunk.
                let outcome = self.begin_gate.as_mut().map(|g| g.feed(&bytes));
                let forwarded = sent(bytes);
                if let Some(outcome @ (Gate::Answer | Gate::Done)) = outcome {
                    self.begin_gate = None;
                    self.begin_session(outcome);
                }
                forwarded
            }
            PreAuthAction::TransitionToLive(bytes) => {
                let forwarded = sent(bytes.clone());
                // plink pauses at "Press Return to begin session." right after
                // the login: not a question, a "press any key". Answered here
                // instead of making the user press Enter a second time.
                let mut gate = BeginGate::new();
                match gate.feed(&bytes) {
                    Gate::Waiting => self.begin_gate = Some(gate),
                    outcome => self.begin_session(outcome),
                }
                forwarded
            }
            PreAuthAction::Suppress => 0,
            PreAuthAction::Withhold(shown) if shown.is_empty() => 0,
            PreAuthAction::Withhold(shown) => sent(shown),
            PreAuthAction::HostKeyPrompt(prompt) => {
                // Never the raw prompt in the terminal: the page shows its own
                // dialog for it.
                let _ = self.registry.prompt_tx.send(PromptEvent { session_id: self.id.clone(), prompt });
                0
            }
            PreAuthAction::Closed(reason) => {
                let _ = self.registry.ended_tx.send(self.id.clone());
                self.send(closing_notice(reason).into_bytes());
                return None;
            }
        })
    }

    /// plink's begin gate is answered (or wasn't needed): the Return goes
    /// while plink still reads a line, and only then is the session begun.
    fn begin_session(&self, outcome: Gate) {
        let mut lock = self.registry.sessions.lock().unwrap();
        if let Some(session) = lock.get_mut(&self.id).filter(|s| s.instance == self.instance) {
            if outcome == Gate::Answer {
                let _ = session.transport.write(b"\r");
            }
            session.transport.session_begun();
        }
    }

    /// Text of Thyrion's own (a notice), straight to the page.
    fn send(&self, bytes: Vec<u8>) {
        if let Some(tx) = self.subscriber.lock().unwrap().as_ref() {
            let _ = tx.send(bytes);
        }
    }
}
