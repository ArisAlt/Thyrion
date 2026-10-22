// A switch console that asks for the enable password: `enable`, then
// "Password:", as IOS does. The password lives in the session's vault
// entry; Thyrion sends it when asked to, and with none saved it says where
// one goes.
import assert from 'node:assert/strict';
import { startConsole, writePuttySession, waitUntil } from '../lib/fixtures.mjs';

export const title = 'Enable password on a Telnet console';

export async function setup({ home }) {
  const sw1 = await startConsole({ name: 'SW1', greet: true, enableSecret: 'en4ble' });
  const sw2 = await startConsole({ name: 'SW2', greet: true, enableSecret: 's3cond' });
  // SW1: the enable password saved, and sent when the device asks.
  writePuttySession(home, 'Core SW1', {
    HostName: '127.0.0.1', PortNumber: sw1.port, Protocol: 'telnet',
    PlinkyVaultKey: 'session:Core SW1', PlinkyAutoEnable: '1',
  });
  // SW2: nothing saved yet.
  writePuttySession(home, 'Access SW2', { HostName: '127.0.0.1', PortNumber: sw2.port, Protocol: 'telnet' });
  return { state: { sw1, sw2 }, cleanup: () => Promise.all([sw1.stop(), sw2.stop()]) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSession(app, name) {
  await app.waitFor((e, n) => !!document.querySelector(`[data-session-row="${n}"]`), [name], { what: `${name} in the list` });
  await app.run((e, n) => e.dblclick(document.querySelector(`[data-session-row="${n}"]`)), name);
  await app.waitForTab(name, 'live', { timeoutMs: 8000 });
  await sleep(300);
}

async function typeLine(app, text) {
  await app.run((e) => e.focusTerminal());
  await app.type(text);
  await app.key('Enter');
}

const statusText = (app) => app.run(() => [...document.querySelectorAll('[role="status"]')].map((x) => x.textContent).join('|'));

export const tests = [
  ['a console with only an enable password saved gets it after `enable`, and nothing else', async ({ app, sw1 }) => {
    await app.invoke('vault_create', { masterPassword: 'e2e-master' });
    const now = Math.floor(Date.now() / 1000);
    // No login on this console: the entry holds only the enable password.
    await app.invoke('vault_set_entry', { entry: { id: 'session:Core SW1', secret: '', enable_secret: 'en4ble', created_at: now, updated_at: now } });
    await openSession(app, 'Core SW1');
    sw1.clear();
    await typeLine(app, 'show clock');
    await sw1.waitForLine('show clock');
    await typeLine(app, 'enable');
    await waitUntil(() => sw1.enabled, { what: 'SW1 in privileged mode', timeoutMs: 6000 });
    assert.deepEqual(sw1.lines, ['show clock', 'enable', 'en4ble'], 'the enable password once, after enable');
    await app.waitForScreen('SW1#');
    assert.doesNotMatch(await app.screenText(), /en4ble/, 'the password is not on screen');
  }],

  ['with no enable password saved, `enable` says so and offers to add one', async ({ app, sw2 }) => {
    await openSession(app, 'Access SW2');
    await typeLine(app, 'enable');
    await app.waitForScreen('Password:');
    await app.waitFor(() => [...document.querySelectorAll('[role="status"]')].some((x) => /No enable password saved for this session/.test(x.textContent)),
      [], { what: 'the "none saved" note' });
    assert.equal(sw2.enabled, false);
    assert.ok(!sw2.lines.includes('s3cond'));
  }],

  ['"Add one…" opens the session\'s Credentials; saved there, Ctrl+Shift+E sends it', async ({ app, sw2 }) => {
    await app.run(() => {
      const b = [...document.querySelectorAll('[role="status"] button')].find((x) => x.textContent.trim() === 'Add one…');
      b.click();
      return true;
    });
    await app.waitFor(() => !!document.getElementById('new-session-modal-enable-password'), [], { what: 'the Enable password field' });
    const onCredentials = await app.run(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent);
    assert.match(onCredentials, /Credentials/);
    await app.run((e) => e.fill(document.getElementById('new-session-modal-enable-password'), 's3cond'));
    await sleep(50);
    await app.run((e) => {
      const b = [...document.querySelectorAll('button[type="submit"]')].find((x) => /Save (session|Changes)/.test(x.textContent));
      return e.click(b);
    });
    await app.waitFor(() => !document.getElementById('new-session-modal-enable-password'), [], { what: 'the editor to close' });
    const saved = (await app.invoke('list_putty_sessions')).find((s) => s.name === 'Access SW2');
    assert.equal(saved.extra?.PlinkyVaultKey, 'session:Access SW2');
    assert.ok(!Object.values(saved.extra ?? {}).includes('s3cond'), 'the password is not in the session file');
    const entry = await app.invoke('vault_get_entry', { key: 'session:Access SW2' });
    assert.equal(entry.enable_secret, 's3cond');

    // The device is still at its Password: prompt.
    await sleep(500);
    await app.run((e) => e.focusTerminal());
    await app.key('Ctrl+Shift+E');
    await waitUntil(() => sw2.enabled, { what: 'SW2 in privileged mode', timeoutMs: 6000 });
    await app.waitForScreen('SW2#');
    assert.doesNotMatch(await statusText(app), /No enable password saved/);
  }],

  ['the terminal menu always offers "Send Enable Password", with its shortcut', async ({ app }) => {
    await app.run((e) => e.rightClick([...document.querySelectorAll('.xterm')].find(e.visible).querySelector('.xterm-screen')));
    const item = await app.run(() => [...document.querySelectorAll('button')].find((x) => /Send Enable Password/.test(x.textContent))?.textContent);
    assert.match(item ?? '', /Ctrl\+Shift\+E/);
    await app.key('Escape');
    await app.run(() => document.body.click());
  }],
];
