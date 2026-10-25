import React from 'react';
import { IDisposable, Terminal } from '@xterm/xterm';

// What a remote shell with Thyrion's hooks reports (Shell hooks in the
// terminal's menu): OSC 133 marks its prompts, OSC 7 its current directory.

export interface PromptMarks {
  /** OSC 133 seen: the shell marks its prompts. */
  integrated: React.RefObject<boolean>;
  /** The cursor is in the prompt's input, not in a command's output. */
  inPromptInput: React.RefObject<boolean>;
  /** Buffer lines where a prompt starts, for Ctrl+Up/Down. */
  promptLines: React.RefObject<number[]>;
}

export function registerShellIntegration(term: Terminal, marks: PromptMarks, onCwdChange?: (cwd: string) => void): IDisposable {
  // Register OSC 133 Shell Integration Handler (Semantic Prompt Gating & Prompt Jumping)
  const osc133Disposable = term.parser.registerOscHandler(133, (data) => {
    marks.integrated.current = true;
    const code = data.charAt(0).toUpperCase();
    if (code === 'B') {
      marks.inPromptInput.current = true;
    } else if (code === 'C' || code === 'D') {
      marks.inPromptInput.current = false;
    } else if (code === 'A') {
      const line = term.buffer.active.cursorY + term.buffer.active.baseY;
      if (!marks.promptLines.current.includes(line)) {
        marks.promptLines.current.push(line);
        if (marks.promptLines.current.length > 500) marks.promptLines.current.shift();
      }
    }
    return false;
  });

  // Register OSC 7 Handler (Current Working Directory Reporting for SFTP Directory Following)
  const osc7Disposable = term.parser.registerOscHandler(7, (data) => {
    try {
      const filePrefix = 'file://';
      let path = '';
      if (data.startsWith(filePrefix)) {
        const rest = data.slice(filePrefix.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx !== -1) {
          path = rest.slice(slashIdx);
        }
      } else if (data.startsWith('/')) {
        path = data;
      }
      if (path) {
        onCwdChange?.(path);
      }
    } catch (e) {
      console.warn('Failed to parse OSC 7 directory:', e);
    }
    return false;
  });

  return {
    dispose: () => {
      osc133Disposable.dispose();
      osc7Disposable.dispose();
    },
  };
}

/** Ctrl+Up/Down: scrolls to the previous or the next prompt OSC 133 marked. */
export function jumpToPrompt(term: Terminal, promptLines: number[], direction: 'prev' | 'next') {
  const currentScrollY = term.buffer.active.viewportY;
  const sorted = [...promptLines].sort((a, b) => a - b);
  if (direction === 'prev') {
    const prev = sorted.reverse().find(l => l < currentScrollY);
    if (prev !== undefined) {
      term.scrollToLine(prev);
    } else if (sorted.length > 0) {
      term.scrollToLine(sorted[0]);
    }
  } else {
    const next = sorted.find(l => l > currentScrollY);
    if (next !== undefined) {
      term.scrollToLine(next);
    } else {
      term.scrollToBottom();
    }
  }
}
