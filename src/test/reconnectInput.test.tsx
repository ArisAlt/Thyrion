import { describe, it, expect, vi } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';

// A stand-in xterm that keeps what the view registers with onData, so the
// test can type into it (as in inputBeforeAttach.test.tsx).
const typed = vi.hoisted(() => ({ onData: null as null | ((d: string) => void) }));
function stand(): any {
  const fn: any = () => stand();
  return new Proxy(fn, {
    get: (_t, p) => {
      if (p === 'cols') return 100;
      if (p === 'rows') return 30;
      if (p === 'write') return (_d: unknown, cb?: () => void) => { cb?.(); };
      if (p === 'writeln') return () => {};
      if (p === 'onData') return (cb: (d: string) => void) => { typed.onData = cb; return stand(); };
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      return stand();
    },
    apply: () => stand(),
    construct: () => stand(),
  });
}
vi.mock('@xterm/xterm', () => ({ Terminal: function Terminal() { return stand(); } }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: function FitAddon() { return stand(); } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: function SearchAddon() { return stand(); } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: function WebLinksAddon() { return stand(); } }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: function Unicode11Addon() { return stand(); } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: function WebglAddon() { return stand(); } }));

const bridge = vi.hoisted(() => ({
  sent: [] as string[],
  finishStart: null as null | (() => void),
}));

vi.mock('../services/tauriBridge', async (orig) => ({
  ...(await orig<typeof import('../services/tauriBridge')>()),
  isTauriEnvironment: () => true,
  writeTerminalInput: async (_id: string, data: Uint8Array) => { bridge.sent.push(new TextDecoder().decode(data)); },
  attachTerminalSession: async (id: string) => ({
    session_id: id, replay_data: [], truncated: false, is_live: true, pending_prompt: null, ended: true,
  }),
  closeTerminalSession: async () => {},
  // The new session takes its time to start, until the test lets it.
  startTerminalSession: () => new Promise((resolve) => {
    bridge.finishStart = () => resolve({ started: true });
  }),
}));

import { TerminalView } from '../components/terminal/TerminalView';
import type { TerminalTab } from '../types/session';

const tab: TerminalTab = {
  id: 'r1', title: 'R1', sessionName: 'R1', syncChannel: 'none',
  status: 'disconnected', freeTypeMode: false, activeHighlighting: true,
  hostname: '127.0.0.1', port: 5000, protocol: 'Telnet',
};

describe('keys typed while Reconnect is starting the session again', () => {
  it('wait for the new session and are sent to it, in order', async () => {
    await act(async () => { render(<TerminalView tab={tab} onUpdateTab={() => {}} />); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reconnect' })); await new Promise(r => setTimeout(r, 20)); });
    expect(bridge.finishStart).toBeTruthy();
    // They went straight to a session that wasn't there yet, and were lost.
    act(() => { typed.onData!('show ver'); typed.onData!('\r'); });
    expect(bridge.sent).toEqual([]);
    await act(async () => { bridge.finishStart!(); await new Promise(r => setTimeout(r, 20)); });
    expect(bridge.sent).toEqual(['show ver', '\r']);
  });
});
