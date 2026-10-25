import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { TerminalTab } from '../../types/session';
import { pastePaced, listenPasteProgress, writeTerminalInput } from '../../services/tauriBridge';
import { classifyPasswordPrompt } from '../../services/promptDetect';
import { isMultiLinePaste } from '../../services/appEvents';
import { askPaste, needsPasteConfirm } from '../../services/pasteConfirm';
import { readClipboard } from '../../services/clipboard';
import { getMiddleClickPaste } from '../../services/middleClickPaste';
import { AddEventLog } from './TerminalLogDialogs';

/** The ways to paste, for listeners set up once per terminal. */
export interface PasteActions {
  confirmThenPaste: (text: string, deliver: (t: string) => Promise<void>) => Promise<void>;
  pasteFromClipboard: (deliver: (t: string) => Promise<void>) => Promise<void>;
  deliverTypedPaste: (text: string) => Promise<void>;
  pacedPaste: (text: string) => boolean;
}

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
  const pasteActionsRef = useRef<PasteActions>({ confirmThenPaste, pasteFromClipboard, deliverTypedPaste, pacedPaste });
  pasteActionsRef.current = { confirmThenPaste, pasteFromClipboard, deliverTypedPaste, pacedPaste };

  return { pasteDelayRef, pasteJob, deliverTypedPaste, pasteFromClipboard, pasteActionsRef };
}

/**
 * Pastes the webview makes itself, and the middle click. Returns a function
 * that stops listening.
 */
export function listenForPastes(target: HTMLElement, term: Terminal, actions: React.RefObject<PasteActions>): () => void {
  // A paste the webview performs itself (its own paste key, a middle
  // click) reaches xterm as a DOM paste event on its textarea. When the
  // paste window should ask first, or this session paces multi-line
  // pastes, take it here (capture phase, before xterm); otherwise xterm
  // pastes as usual (bracketed paste and all).

  // Until when a paste event is the webview's own middle-click paste of
  // one we already sent (middleClickPaste.ts): dropped, not sent twice.
  let swallowPasteUntil = 0;
  const onPasteCapture = (e: ClipboardEvent) => {
    if (Date.now() < swallowPasteUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const paced = actions.current.pacedPaste(text);
    if (paced || needsPasteConfirm(text)) {
      e.preventDefault();
      e.stopPropagation();
      const a = actions.current;
      void a.confirmThenPaste(text, t => actions.current.deliverTypedPaste(t));
    }
  };
  target.addEventListener('paste', onPasteCapture, true);

  // Middle click pastes the clipboard, as PuTTY's does, through the same
  // path as the paste keys. Taken before xterm and the webview: stopping
  // the press keeps WebView2 from starting autoscroll and WebKitGTK from
  // pasting the X selection as well. A program that asked for the mouse
  // (vim with mouse=a) gets the click instead, unless Shift is held, as
  // in PuTTY.
  let middlePressed = false;
  const takesMiddleClick = (e: MouseEvent) =>
    e.button === 1 && getMiddleClickPaste() && !!(e.target as Element | null)?.closest?.('.xterm') &&
    (e.shiftKey || term.modes.mouseTrackingMode === 'none');
  const onMiddleDown = (e: MouseEvent) => {
    middlePressed = takesMiddleClick(e);
    if (!middlePressed) return;
    e.preventDefault();
    e.stopPropagation();
    swallowPasteUntil = Date.now() + 1000;
  };
  const onMiddleUp = (e: MouseEvent) => {
    if (e.button !== 1 || !middlePressed) return;
    middlePressed = false;
    e.preventDefault();
    e.stopPropagation();
    swallowPasteUntil = Date.now() + 500;
    term.focus();
    void actions.current.pasteFromClipboard(t => actions.current.deliverTypedPaste(t));
  };
  // The click and auxclick after it: nothing else should act on them.
  const onMiddleClick = (e: MouseEvent) => {
    if (e.button === 1 && Date.now() < swallowPasteUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  target.addEventListener('mousedown', onMiddleDown, true);
  target.addEventListener('mouseup', onMiddleUp, true);
  target.addEventListener('auxclick', onMiddleClick, true);

  return () => {
    target.removeEventListener('paste', onPasteCapture, true);
    target.removeEventListener('mousedown', onMiddleDown, true);
    target.removeEventListener('mouseup', onMiddleUp, true);
    target.removeEventListener('auxclick', onMiddleClick, true);
  };
}
