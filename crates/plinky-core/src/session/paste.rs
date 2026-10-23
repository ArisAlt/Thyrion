//! Paced paste: send pasted text one line at a time with a delay between
//! lines. Console ports and many network devices have tiny input buffers; a
//! config pasted at full speed drops characters (SecureCRT's "line send
//! delay").
//!
//! On a serial line each line also waits for the device to echo the one
//! before. A console echoes every byte and then prints its prompt, so it
//! sends more than it receives; at full speed it falls behind and drops
//! input. Measured on a Cisco C891F at 9600 baud: 500 pasted lines of 70
//! characters lost 49-97 lines sent flat out (PuTTY 387/500 intact), none
//! when each line waited for the last one's echo, for ~20% more time.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

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

/// Counts the line feeds a session has printed.
#[derive(Debug, Default)]
pub struct LineFeeds {
    count: AtomicU64,
    more: Notify,
}

impl LineFeeds {
    pub fn saw(&self, output: &[u8]) {
        let n = output.iter().filter(|&&b| b == b'\n').count() as u64;
        if n > 0 {
            self.count.fetch_add(n, Ordering::SeqCst);
            self.more.notify_waiters();
        }
    }

    pub fn count(&self) -> u64 {
        self.count.load(Ordering::SeqCst)
    }

    /// Waits until more than `seen` line feeds have been printed. False if
    /// `timeout` passed first.
    pub async fn wait_past(&self, seen: u64, timeout: Duration) -> bool {
        tokio::time::timeout(timeout, async {
            loop {
                let more = self.more.notified();
                tokio::pin!(more);
                more.as_mut().enable();
                if self.count() > seen {
                    return;
                }
                more.await;
            }
        })
        .await
        .is_ok()
    }
}

/// How long a pasted line waits for its echo before the next goes anyway
/// (a device that doesn't echo, or a line it swallowed): longer than the
/// line takes to send at 9600 baud, ~1 ms a byte.
fn echo_timeout(line: &[u8]) -> Duration {
    Duration::from_millis(1000 + 2 * line.len() as u64)
}

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
        let mut waiting: Option<(u64, Duration)> = None;
        for line in lines {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if let (Some(echo), Some((seen, timeout))) = (&echo, waiting.take()) {
                echo.wait_past(seen, timeout).await;
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
            // A line ending in Enter is echoed with a line feed.
            if let (Some(echo), Some(b'\r')) = (&echo, line.last()) {
                waiting = Some((echo.count(), echo_timeout(&line)));
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
}
