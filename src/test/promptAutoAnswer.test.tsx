import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';

// A stand-in xterm: any property is a no-op that returns another stand-in,
// write() runs its callback, and the size is fixed. Enough for TerminalView
// to mount and process output without a canvas.
function stand(): any {
  const fn: any = () => stand();
  return new Proxy(fn, {
    get: (_t, p) => {
      if (p === 'cols') return 100;
      if (p === 'rows') return 30;
      if (p === 'write') return (_d: unknown, cb?: () => void) => { cb?.(); };
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined; // not a promise
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

const bridge = vi.hoisted(() => ({ liveChunk: null as null | ((chunk: Uint8Array) => void), sent: [] as string[], replay: '' }));

vi.mock('../services/tauriBridge', async (orig) => ({
  ...(await orig<typeof import('../services/tauriBridge')>()),
  isTauriEnvironment: () => true,
  attachTerminalSession: async (id: string, _seq: number, onData: (c: Uint8Array) => void) => {
    bridge.liveChunk = onData;
    // A replay arrives once the vault is known, as it can after a remount.
    if (bridge.replay) await new Promise(r => setTimeout(r, 30));
    return { session_id: id, replay_data: Array.from(new TextEncoder().encode(bridge.replay)), truncated: false, is_live: true, pending_prompt: null };
  },
  // A console that logs in from the vault by itself.
  vaultLookup: async () => ({ locked: false, key: 'Core SW1', hasEnableSecret: false, hasLoginSecret: true, username: null, autoLogin: true, autoEnable: false }),
  vaultIsInitialized: async () => true,
  vaultSendSecret: async (_id: string, _key: string, field: string) => { bridge.sent.push(field); },
}));

import { TerminalView } from '../components/terminal/TerminalView';
import { consoleLoginState, forgetConsoleLogin } from '../services/consoleLogin';
import type { TerminalTab } from '../types/session';

const tab: TerminalTab = {
  id: 'tab-console', title: 'Core SW1', sessionName: 'Core SW1', syncChannel: 'none', status: 'live',
  freeTypeMode: false, activeHighlighting: true, hostname: '192.0.2.11', port: 23, protocol: 'Telnet',
};

describe('a password prompt answered automatically', () => {
  beforeEach(() => { bridge.liveChunk = null; bridge.sent = []; bridge.replay = ''; forgetConsoleLogin(tab.id); });

  it('leaves no Send password offer behind', async () => {
    // The offer was put up and taken down in the same chunk; taking it down
    // read a ref that only followed at the next render, so it stayed, and
    // its button sent the password a second time.
    await act(async () => { render(<TerminalView tab={tab} onUpdateTab={() => {}} />); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { bridge.liveChunk!(new TextEncoder().encode('\r\nUser Access Verification\r\n\r\nPassword: ')); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(bridge.sent).toEqual(['login']);
    expect(screen.queryByRole('button', { name: 'Send password' })).toBeNull();
  });

  it('answers nothing in replayed output: switching back to the tab sent the console password to a nested ssh', async () => {
    // The tab was switched away and back: its view remounted, and the
    // scrollback replayed ends with another host's password prompt.
    bridge.replay = 'Core-SW1#ssh admin@10.0.0.2\r\nadmin@10.0.0.2\'s password: ';
    await act(async () => { render(<TerminalView tab={tab} onUpdateTab={() => {}} />); });
    await act(async () => { await new Promise(r => setTimeout(r, 80)); });
    expect(bridge.sent).toEqual([]);
  });

  it('remembers across a remount that a command was run, so a later Password: gets nothing', async () => {
    // Set by the view before the tab switch, kept per tab for the connection.
    consoleLoginState(tab.id).commandRun = true;
    await act(async () => { render(<TerminalView tab={tab} onUpdateTab={() => {}} />); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    await act(async () => { bridge.liveChunk!(new TextEncoder().encode('\r\nadmin@10.0.0.2\'s password: ')); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(bridge.sent).toEqual([]);
  });
});
