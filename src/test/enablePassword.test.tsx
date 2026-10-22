import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';

// The terminal's "Send Enable Password": always offered, Ctrl+Shift+E, and
// with none saved it says so and where to add one.
const env = vi.hoisted(() => ({
  invoked: [] as { cmd: string; args?: any }[],
  lookup: { locked: false, key: null as string | null, hasEnableSecret: false, hasLoginSecret: false },
  vaultExists: true,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: any) => {
    env.invoked.push({ cmd, args });
    if (cmd === 'vault_lookup') return { ...env.lookup, autoLogin: false, autoEnable: false };
    if (cmd === 'vault_is_initialized') return env.vaultExists;
    return null;
  },
}));

const term = vi.hoisted(() => ({ keyHandler: null as null | ((e: KeyboardEvent) => boolean) }));
function stand(): any {
  const fn: any = () => stand();
  return new Proxy(fn, {
    get: (_t, p) => {
      if (p === 'cols') return 100;
      if (p === 'rows') return 30;
      if (p === 'write') return (_d: unknown, cb?: () => void) => { cb?.(); };
      if (p === 'attachCustomKeyEventHandler') return (h: (e: KeyboardEvent) => boolean) => { term.keyHandler = h; };
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

vi.mock('../services/tauriBridge', async (orig) => ({
  ...(await orig<typeof import('../services/tauriBridge')>()),
  isTauriEnvironment: () => true,
  attachTerminalSession: async () => null,
  startTerminalSession: async () => ({ started: false }),
  vaultLookup: async () => ({ ...env.lookup, autoLogin: false, autoEnable: false }),
  vaultIsInitialized: async () => env.vaultExists,
  vaultSendSecret: async (sessionId: string, key: string, field: string) => {
    env.invoked.push({ cmd: 'vault_send_secret', args: { sessionId, key, field } });
  },
}));

import { TerminalView } from '../components/terminal/TerminalView';
import type { TerminalTab } from '../types/session';

const tab: TerminalTab = {
  id: 'tab-enable', title: 'Core SW1', sessionName: 'Core SW1', syncChannel: 'none', status: 'live',
  freeTypeMode: false, activeHighlighting: true, hostname: '192.0.2.11', port: 23, protocol: 'Telnet',
};
const ctrlShiftE = () => new KeyboardEvent('keydown', { code: 'KeyE', ctrlKey: true, shiftKey: true });
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 10)); });

async function open(props: Partial<React.ComponentProps<typeof TerminalView>> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<TerminalView tab={tab} onUpdateTab={() => {}} rightClickAction="contextMenu" {...props} />);
  });
  await settle();
  return view;
}

describe('sending the enable password from the terminal', () => {
  beforeEach(() => {
    env.invoked = [];
    env.lookup = { locked: false, key: null, hasEnableSecret: false, hasLoginSecret: false };
    env.vaultExists = true;
    term.keyHandler = null;
  });

  it('is in the right-click menu with its shortcut, even with none saved', async () => {
    const { container } = await open();
    fireEvent.contextMenu(container.firstElementChild!);
    const item = screen.getByRole('button', { name: /Send Enable Password/ });
    expect(item.textContent).toContain('Ctrl+Shift+E');
    expect(item.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+E');
    // No login password to offer: that item stays away.
    expect(screen.queryByRole('button', { name: /Send Login Password/ })).toBeNull();
  });

  it('with none saved, Ctrl+Shift+E says so and "Add one…" opens Credentials', async () => {
    const edit = vi.fn();
    await open({ onEditSessionSettings: edit });
    let passed = true;
    await act(async () => { passed = term.keyHandler!(ctrlShiftE()); });
    expect(passed).toBe(false); // the device never sees it
    const note = screen.getByRole('status');
    expect(note.textContent).toMatch(/No enable password saved for this session/);
    fireEvent.click(screen.getByRole('button', { name: 'Add one…' }));
    expect(edit).toHaveBeenCalledWith('credentials');
    expect(env.invoked.some(i => i.cmd === 'vault_send_secret')).toBe(false);
  });

  it('with one saved, sends it from the vault', async () => {
    env.lookup = { locked: false, key: 'session:Core SW1', hasEnableSecret: true, hasLoginSecret: true };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await open();
    await act(async () => { term.keyHandler!(ctrlShiftE()); });
    await settle();
    // No prompt on screen: it asks first, as "Send password" always has.
    expect(confirm).toHaveBeenCalled();
    expect(env.invoked).toContainEqual({ cmd: 'vault_send_secret', args: { sessionId: 'tab-enable', key: 'session:Core SW1', field: 'enable' } });
    confirm.mockRestore();
  });

  it('with the vault locked, asks to unlock it for the enable password', async () => {
    env.lookup = { locked: true, key: null, hasEnableSecret: false, hasLoginSecret: false };
    await open();
    await act(async () => { term.keyHandler!(ctrlShiftE()); });
    expect(screen.getByText(/enable password is in the vault/)).toBeTruthy();
  });

  it('with no vault yet, says that is why', async () => {
    env.lookup = { locked: true, key: null, hasEnableSecret: false, hasLoginSecret: false };
    env.vaultExists = false;
    await open({ onEditSessionSettings: vi.fn() });
    await act(async () => { term.keyHandler!(ctrlShiftE()); });
    expect(screen.getByRole('status').textContent).toMatch(/there is no vault yet/);
  });

  it('a local shell keeps Ctrl+Shift+E', async () => {
    await open({ tab: { ...tab, id: 'tab-local', sessionName: 'Local Shell', protocol: undefined } as TerminalTab });
    let passed = false;
    await act(async () => { passed = term.keyHandler!(ctrlShiftE()); });
    expect(passed).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
