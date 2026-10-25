import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { TerminalTab } from '../../types/session';
import { pastePaced, listenPasteProgress, writeTerminalInput } from '../../services/tauriBridge';
import { classifyPasswordPrompt } from '../../services/promptDetect';
import { isMultiLinePaste } from '../../services/appEvents';
import { askPaste, needsPasteConfirm } from '../../services/pasteConfirm';
import { readClipboard } from '../../services/clipboard';
import { AddEventLog } from './TerminalLogDialogs';

// How a terminal pastes: through the paste window when Settings asks for
// it, then flat out, through xterm, or one line at a time.

export function useTerminalPaste({ tab, isSerial, isLivePtyRef, terminalRef, addEventLog, detectedPasswordPrompt, recentOutputRef }: {
  tab: TerminalTab;
  isSerial: boolean;
  isLivePtyRef: React.RefObject<boolean>;
  terminalRef: React.RefObject<Terminal | null>;
  addEventLog: AddEventLog;
  detectedPasswordPrompt: 'login' | 'enable' | null;
  recentOutputRef: React.RefObject<string>;
}) {
  // ---- Paste with a delay between lines (T-015) --------------------------
  // Console ports and network gear drop characters when a config is pasted
  // at full speed. With the session's "paste line delay" set, a multi-line
  // paste is sent one line at a time by the backend (paste_paced).
  const pasteDelayRef = useRef(0);
  const [pasteJob, setPasteJob] = useState<{ sent: number; total: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenPasteProgress(p => {
      if (p.sessionId === tab.id) setPasteJob({ sent: p.sent, total: p.total });
    }).then(u => { if (disposed) u?.(); else unlisten = u; });
    return () => { disposed = true; unlisten?.(); };
  }, [tab.id]);

  /** Whether a multi-line paste goes line by line: when the session asks
   *  for a delay, and always on a serial line, where the backend sends each
   *  line once the device has echoed the last (a console overrun by a paste
   *  sent flat out drops lines; see session/paste.rs). */
  const pacedPaste = (text: string) =>
    (pasteDelayRef.current > 0 || isSerial) && isLivePtyRef.current && isMultiLinePaste(text);

  /** Every paste goes through here: paced when the session asks for it. */
  const pasteText = async (text: string) => {
    if (!text) return;
    if (!isLivePtyRef.current) {
      terminalRef.current?.write(text);
      return;
    }
    const delay = pasteDelayRef.current;
    if (pacedPaste(text)) {
      const total = text.replace(/[\r\n]+$/, '').split(/\r\n|\r|\n/).length;
      setPasteJob({ sent: 0, total });
      try {
        const sent = await pastePaced(tab.id, text, delay);
        addEventLog(sent < total
          ? `Paste cancelled after ${sent} of ${total} lines`
          : isSerial ? `Pasted ${sent} lines, each after the last one's echo` : `Pasted ${sent} lines, ${delay} ms apart`,
          sent < total ? 'warn' : 'info');
      } catch (e) {
        addEventLog(String(e), 'error');
      } finally {
        setPasteJob(null);
      }
      return;
    }
    writeTerminalInput(tab.id, new TextEncoder().encode(text));
  };

  /** A paste the way the terminal itself sends one: paced when this session
   *  asks for it, otherwise through xterm (bracketed paste, line endings). */
  const deliverTypedPaste = async (text: string) => {
    if (pacedPaste(text)) {
      await pasteText(text);
      return;
    }
    terminalRef.current?.paste(text);
  };

  /** Every paste passes the paste window first when Settings asks for it
   *  (pasteConfirm.ts); `deliver` is how this particular paste is sent. */
  const confirmThenPaste = async (text: string, deliver: (t: string) => Promise<void>) => {
    if (!text) return;
    if (needsPasteConfirm(text)) {
      const approved = await askPaste({
        text,
        target: tab.title,
        lineDelayMs: pasteDelayRef.current,
        echoPaced: isSerial,
        // A password pasted at its prompt stays off the screen until asked.
        sensitive: !!detectedPasswordPrompt || classifyPasswordPrompt(recentOutputRef.current) !== null,
      });
      if (approved === null) return;
      text = approved;
    }
    await deliver(text);
  };

  /** Reads the clipboard, then pastes through the paste window. */
  const pasteFromClipboard = async (deliver: (t: string) => Promise<void>) => {
    let text: string;
    try {
      text = await readClipboard();
    } catch (e) {
      addEventLog(`Couldn't read the clipboard: ${e}`, 'error');
      return;
    }
    await confirmThenPaste(text, deliver);
  };
  // The listeners set up once per terminal reach the current versions here.
  const pasteActionsRef = useRef({ confirmThenPaste, pasteFromClipboard, deliverTypedPaste, pacedPaste });
  pasteActionsRef.current = { confirmThenPaste, pasteFromClipboard, deliverTypedPaste, pacedPaste };

  return { pasteDelayRef, pasteJob, deliverTypedPaste, pasteFromClipboard, pasteActionsRef };
}
