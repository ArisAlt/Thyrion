//! Paced paste: send pasted text one line at a time with a delay between
//! lines. Console ports and many network devices have tiny input buffers; a
//! config pasted at full speed drops characters (SecureCRT's "line send
//! delay").
//!
//! On a serial line each line also waits for the device to echo the one
//! before (its end, then a line feed). A console echoes every byte and then prints its prompt, so it
//! sends more than it receives; at full speed it falls behind and drops
//! input. Measured on a Cisco C891F at 9600 baud: 500 pasted lines of 70
//! characters lost 49-97 lines sent flat out (PuTTY 387/500 intact), none
//! when each line waited for the last one's echo, for ~20% more time.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use crate::errors::{PlinkyError, Result};
use crate::session::manager::SessionRegistry;

/// Bounds so a stray paste can't pin a session for hours.
pub const MAX_LINE_DELAY_MS: u64 = 5_000;
pub const MAX_PASTE_BYTES: usize = 1024 * 1024;

/// Splits pasted text into the chunks to send. Every line that was followed
/// by a newline ends in CR (what Enter sends to a terminal). A final line
/// with no newline after it is sent without CR, so it waits at the prompt --
/// exactly what an unpaced paste of the same text would do.
pub fn split_paste_lines(text: &str) -> Vec<Vec<u8>> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut parts: Vec<&str> = normalized.split('\n').collect();
    let tail = parts.pop().unwrap_or("");
    let mut lines: Vec<Vec<u8>> = parts
        .into_iter()
        .map(|line| {
            let mut bytes = line.as_bytes().to_vec();
            bytes.push(b'\r');
            bytes
        })
        .collect();
    if !tail.is_empty() {
        lines.push(tail.as_bytes().to_vec());
    }
    lines
}

/// What a session printed lately, for a paste that waits for each line's
/// own echo. A line feed alone wasn't enough: a console prints log messages
/// whenever it likes (`%LINK-3-UPDOWN`), and one arriving mid-paste would
/// let the next line go before the last was echoed.
#[derive(Debug, Default)]
pub struct Echoes {
    recent: Mutex<Recent>,
    more: Notify,
}

#[derive(Debug, Default)]
struct Recent {
    /// Bytes printed since the session started.
    total: u64,
    /// The last `KEPT` of them.
    bytes: VecDeque<u8>,
    /// When the last of them came.
    at: Option<Instant>,
}

/// More than a pasted line's echo, the prompt and a few log lines.
const KEPT: usize = 64 * 1024;

/// How much of a line's end has to come back before its line feed: enough
/// not to be found in a log message by chance.
const ECHO_KEY: usize = 8;

/// What is compared of a line and its echo. A line wider than the terminal
/// comes back in pieces: IOS scrolls it sideways, printing `$`, padding
/// spaces and backspaces between the characters typed (measured on a
/// C891F: `012345` + 9 spaces + 9 backspaces + `6789ab`). Without those the
/// typed characters are back in one piece. A CR is the Enter, not the line.
fn shown(b: u8) -> bool {
    !matches!(b, b' ' | b'\x08' | b'$' | b'\r')
}

impl Echoes {
    pub fn saw(&self, output: &[u8]) {
        let mut r = self.recent.lock().unwrap();
        r.total += output.len() as u64;
        r.bytes.extend(output);
        r.at = Some(Instant::now());
        let over = r.bytes.len().saturating_sub(KEPT);
        r.bytes.drain(..over);
        drop(r);
        self.more.notify_waiters();
    }

    /// Where the output is now: what a line written next is echoed after.
    pub fn mark(&self) -> u64 {
        self.recent.lock().unwrap().total
    }

    /// Whether `line` came back after `mark`: its last characters, then a
    /// line feed.
    fn echoed(&self, mark: u64, line: &[u8]) -> bool {
        let mut r = self.recent.lock().unwrap();
        let since = (r.total - mark) as usize;
        if since > r.bytes.len() {
            return true; // more printed than kept: it has long been echoed
        }
        let skip = r.bytes.len() - since;
        let out: Vec<u8> = r.bytes.make_contiguous()[skip..].iter().copied().filter(|&b| shown(b)).collect();
        let typed: Vec<u8> = line.iter().copied().filter(|&b| shown(b)).collect();
        let key = &typed[typed.len().saturating_sub(ECHO_KEY)..];
        let after = if key.is_empty() {
            0 // a blank line: its line feed is all there is
        } else {
            match out.windows(key.len()).position(|w| w == key) {
                Some(i) => i + key.len(),
                None => return false,
            }
        };
        out[after..].contains(&b'\n')
    }

    /// Waits for `line` to be echoed after `mark`. Gives up (false) once
    /// the console has printed nothing for `ECHO_QUIET` (it doesn't echo,
    /// or swallowed the line), or after `ECHO_MAX` in all. Not a fixed time
    /// per line: a C891F at 9600 baud took 1.4 s to echo a 150-character
    /// line it scrolled sideways (1.3 KB of redraws).
    pub async fn wait_for(&self, mark: u64, line: &[u8]) -> bool {
        let started = Instant::now();
        let deadline = started + ECHO_MAX;
        loop {
            let more = self.more.notified();
            tokio::pin!(more);
            more.as_mut().enable();
            if self.echoed(mark, line) {
                return true;
            }
            let heard = self.recent.lock().unwrap().at.map_or(started, |at| at.max(started));
            let until = (heard + ECHO_QUIET).min(deadline);
            if Instant::now() >= until {
                return false;
            }
            let _ = tokio::time::timeout_at(until.into(), more).await;
        }
    }
}

/// How long a pasted line waits on a silent console for its echo before
/// the next goes anyway.
const ECHO_QUIET: Duration = Duration::from_secs(1);
/// The longest a line waits for its echo while the console keeps printing
/// other things.
const ECHO_MAX: Duration = Duration::from_secs(10);

impl SessionRegistry {
    /// Writes `text` line by line with `line_delay` between lines. Goes
    /// through write_input_live_only: a multi-line paste into a pre-auth
    /// prompt is exactly how bootstrap text once got submitted as a series of
    /// password guesses, so it's refused until the session is Live.
    ///
    /// Stops early (Ok) when `cancel` is set; stops with the write error if
    /// the session dies or leaves Live. Returns the number of lines sent.
    pub async fn paste_paced(
        &self,
        id: &str,
        text: &str,
        line_delay: Duration,
        cancel: Arc<AtomicBool>,
        mut progress: impl FnMut(usize, usize),
    ) -> Result<usize> {
        if text.len() > MAX_PASTE_BYTES {
            return Err(PlinkyError::ProcessError(format!(
                "Paste too large ({} bytes, max {MAX_PASTE_BYTES})",
                text.len()
            )));
        }
        if line_delay > Duration::from_millis(MAX_LINE_DELAY_MS) {
            return Err(PlinkyError::ProcessError(format!(
                "Line delay too long (max {MAX_LINE_DELAY_MS} ms)"
            )));
        }

        let lines = split_paste_lines(text);
        let total = lines.len();
        let echo = self.paste_echo(id);
        let mut sent = 0;
        let mut waiting: Option<(u64, Vec<u8>)> = None;
        for line in lines {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if let (Some(echo), Some((mark, last))) = (&echo, waiting.take()) {
                echo.wait_for(mark, &last).await;
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
            }
            if sent > 0 && !line_delay.is_zero() {
                tokio::time::sleep(line_delay).await;
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
            }
            // A line ending in Enter comes back with a line feed.
            if let (Some(echo), Some(b'\r')) = (&echo, line.last()) {
                waiting = Some((echo.mark(), line.clone()));
            }
            self.write_input_live_only(id, &line)?;
            sent += 1;
            progress(sent, total);
        }
        Ok(sent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_followed_by_newline_get_cr() {
        assert_eq!(
            split_paste_lines("interface Gi0/1\n shutdown\n"),
            vec![b"interface Gi0/1\r".to_vec(), b" shutdown\r".to_vec()]
        );
    }

    #[test]
    fn trailing_partial_line_is_sent_without_enter() {
        assert_eq!(
            split_paste_lines("conf t\nhostname sw1"),
            vec![b"conf t\r".to_vec(), b"hostname sw1".to_vec()]
        );
    }

    #[test]
    fn crlf_and_blank_lines_are_preserved() {
        assert_eq!(
            split_paste_lines("a\r\n\r\nb\r\n"),
            vec![b"a\r".to_vec(), b"\r".to_vec(), b"b\r".to_vec()]
        );
    }

    #[test]
    fn empty_paste_sends_nothing() {
        assert!(split_paste_lines("").is_empty());
    }

    #[test]
    fn a_line_is_echoed_by_its_end_then_a_line_feed() {
        let e = Echoes::default();
        e.saw(b"R1#");
        let mark = e.mark();
        let line = b"interface GigabitEthernet0/1\r";
        assert!(!e.echoed(mark, line));
        e.saw(b"interface GigabitEther");
        assert!(!e.echoed(mark, line), "half the echo");
        e.saw(b"net0/1");
        assert!(!e.echoed(mark, line), "no Enter yet");
        e.saw(b"\r\nR1(config-if)#");
        assert!(e.echoed(mark, line));
    }

    #[test]
    fn a_log_message_is_not_the_echo() {
        let e = Echoes::default();
        let mark = e.mark();
        let line = b" description uplink\r";
        e.saw(b"\r\n*Oct 23 19:40:01: %LINK-3-UPDOWN: Interface GigabitEthernet7, changed state to up\r\n");
        assert!(!e.echoed(mark, line));
        e.saw(b" description uplink\r\n");
        assert!(e.echoed(mark, line));
    }

    #[test]
    fn what_came_before_the_line_was_sent_is_not_its_echo() {
        let e = Echoes::default();
        e.saw(b"R1#show version\r\n");
        let mark = e.mark();
        assert!(!e.echoed(mark, b"show version\r"));
    }

    #[tokio::test]
    async fn a_slow_echo_is_waited_for_while_it_keeps_coming() {
        let e = Arc::new(Echoes::default());
        let mark = e.mark();
        let feed = e.clone();
        tokio::spawn(async move {
            for _ in 0..15 {
                tokio::time::sleep(Duration::from_millis(100)).await;
                feed.saw(b"\x08\x08$redrawn ");
            }
            feed.saw(b"show clock\r\nR1#");
        });
        let started = Instant::now();
        assert!(e.wait_for(mark, b"show clock\r").await);
        assert!(started.elapsed() >= Duration::from_millis(1400), "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn a_silent_console_is_given_up_on_after_a_second() {
        let e = Echoes::default();
        let started = Instant::now();
        assert!(!e.wait_for(e.mark(), b"show clock\r").await);
        let took = started.elapsed();
        assert!(took >= Duration::from_millis(950) && took < Duration::from_millis(1500), "{took:?}");
    }

    #[test]
    fn an_empty_line_is_echoed_by_a_line_feed() {
        let e = Echoes::default();
        let mark = e.mark();
        assert!(!e.echoed(mark, b"\r"));
        e.saw(b"\r\nR1#");
        assert!(e.echoed(mark, b"\r"));
    }

    #[test]
    fn a_long_line_scrolled_sideways_still_ends_in_its_echo() {
        // What a C891F printed for the end of a 117-character line.
        let e = Echoes::default();
        let mark = e.mark();
        let line = b"! wide abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789ab\r";
        e.saw(b"\x08\x08\x08\x08ijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz012345         \x08\x08\x08\x08\x08\x08\x08\x08\x08");
        assert!(!e.echoed(mark, line), "still typing");
        e.saw(b"6789ab\r\ncroute#");
        assert!(e.echoed(mark, line));
    }
}
