import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const paced = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../services/tauriBridge', async (orig) => ({
  ...(await orig<typeof import('../services/tauriBridge')>()),
  pastePaced: async (_id: string, text: string) => { paced.calls.push(text); return text.trim().split('\n').length; },
  listenPasteProgress: async () => () => {},
}));
vi.mock('../services/pasteConfirm', async (orig) => ({
  ...(await orig<typeof import('../services/pasteConfirm')>()),
  needsPasteConfirm: () => false,
}));

import { useTerminalPaste } from '../components/terminal/useTerminalPaste';
import type { TerminalTab } from '../types/session';

const tab: TerminalTab = {
  id: 'tab-serial', title: 'Core SW1', sessionName: 'Core SW1', syncChannel: 'none', status: 'live',
  freeTypeMode: false, activeHighlighting: true, hostname: '/dev/ttyUSB0', port: 22, protocol: 'Serial',
};

describe('a paste sent line by line', () => {
  it('counts as commands run, so the console login stays out of what they start', async () => {
    // Pasted lines on a serial console skip xterm, where typed commands are
    // seen: after "show clock\nssh admin@10.0.0.2", that host's Password:
    // got the console's password.
    const onCommandsSent = vi.fn();
    const { result } = renderHook(() => useTerminalPaste({
      tab, isSerial: true, isLivePtyRef: { current: true }, terminalRef: { current: null },
      addEventLog: () => {}, detectedPasswordPrompt: null, recentOutputRef: { current: '' }, onCommandsSent,
    }));
    await act(async () => { await result.current.deliverTypedPaste('show clock\nssh admin@10.0.0.2\n'); });
    expect(paced.calls).toHaveLength(1);
    expect(onCommandsSent).toHaveBeenCalled();
  });
});
