// A switch console that asks for the enable password: `enable`, then
// "Password:", as IOS does. The password lives in the session's vault
// entry; Thyrion sends it when asked to, and with none saved it says where
// one goes.
import assert from 'node:assert/strict';
import { startConsole, writePuttySession, waitUntil } from '../lib/fixtures.mjs';

export const title = 'Enable password on a Telnet console';

export async function setup({ home, defer }) {
  const sw1 = await startConsole({ name: 'SW1', greet: true, enableSecret: 'en4ble' });
  defer(() => sw1.stop());
  const sw2 = await startConsole({ name: 'SW2', greet: true, enableSecret: 's3cond' });
  defer(() => sw2.stop());
  // SW1: the enable password saved, and sent when the device asks.
  writePuttySession(home, 'Core SW1', {
    HostName: '127.0.0.1', PortNumber: sw1.port, Protocol: 'telnet',
    PlinkyVaultKey: 'session:Core SW1', PlinkyAutoEnable: '1',
  });
  // SW2: nothing saved yet.
  writePuttySession(home, 'Access SW2', { HostName: '127.0.0.1', PortNumber: sw2.port, Protocol: 'telnet' });
  return { state: { sw1, sw2 } };
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

  ['with the vault locked, Save asks for the master password, then stores the new one', async ({ app }) => {
    await app.invoke('vault_lock');
    await editEnablePassword(app, 'Access SW2', 'th1rd');
    await app.waitFor(() => !!document.getElementById('vault-unlock-password'), [], { what: 'the unlock dialog' });
    await app.run((e) => e.fill(document.getElementById('vault-unlock-password'), 'e2e-master'));
    await sleep(50);
    await clickInDialog(app, 'Unlock');
    await app.waitFor(() => !document.getElementById('new-session-modal-enable-password'), [], { what: 'the editor to close', timeoutMs: 10000 });
    const entry = await app.invoke('vault_get_entry', { key: 'session:Access SW2' });
    assert.equal(entry.enable_secret, 'th1rd');
  }],

  ['"Save without the password" saves the settings and leaves the vault as it was', async ({ app }) => {
    await app.invoke('vault_lock');
    await editEnablePassword(app, 'Access SW2', 'f0urth');
    await app.waitFor(() => !!document.getElementById('vault-unlock-password'), [], { what: 'the unlock dialog' });
    const said = await app.run(() => document.querySelector('[role="dialog"][aria-labelledby="vault-unlock-title"]').textContent);
    assert.match(said, /save the session without the password/);
    await clickInDialog(app, 'Save without the password');
    await app.waitFor(() => !document.getElementById('new-session-modal-enable-password'), [], { what: 'the editor to close' });
    const saved = (await app.invoke('list_putty_sessions')).find((s) => s.name === 'Access SW2');
    assert.equal(saved.extra?.PlinkyVaultKey, 'session:Access SW2', 'still linked to its entry');
    assert.ok(!Object.values(saved.extra ?? {}).includes('f0urth'), 'the password is not in the session file');
    assert.equal(await app.invoke('vault_is_unlocked'), false, 'the vault stayed locked');
    await app.invoke('vault_unlock', { masterPassword: 'e2e-master' });
    const entry = await app.invoke('vault_get_entry', { key: 'session:Access SW2' });
    assert.equal(entry.enable_secret, 'th1rd', 'the stored password is unchanged');
  }],

  ['a wrong master password, then the right one, unlocks the vault when Credentials opens', async ({ app }) => {
    // Reported: after a wrong password the right one didn't close the window.
    await app.invoke('vault_lock');
    await app.run((e) => {
      const btn = document.querySelector('button[aria-label="Edit Access SW2"]');
      btn.scrollIntoView();
      return e.click(btn);
    });
    await app.waitFor(() => !!document.getElementById('new-session-modal-host-name-or-ip-address'), [], { what: 'the session editor' });
    await app.run((e) => e.click([...document.querySelectorAll('[role="tab"]')].find((x) => /Credentials/.test(x.textContent))));
    await unlockAfterAWrongPassword(app);
    assert.equal(await app.invoke('vault_is_unlocked'), true);
    // Escape where the user's focus is: in the editor.
    await app.run((e) => e.key('Escape', document.getElementById('new-session-modal-host-name-or-ip-address')));
    await app.waitFor(() => !document.getElementById('new-session-modal-host-name-or-ip-address'), [], { what: 'the editor to close' });
  }],

  ['a wrong master password, then the right one, unlocks the vault and the save carries on', async ({ app }) => {
    await app.invoke('vault_lock');
    await editEnablePassword(app, 'Access SW2', 'f1fth');
    await unlockAfterAWrongPassword(app);
    await app.waitFor(() => !document.getElementById('new-session-modal-enable-password'), [], { what: 'the editor to close', timeoutMs: 10000 });
    const entry = await app.invoke('vault_get_entry', { key: 'session:Access SW2' });
    assert.equal(entry.enable_secret, 'f1fth');
  }],
];

/** The unlock dialog: a wrong master password is refused, the right one
 *  then unlocks and the dialog closes. */
async function unlockAfterAWrongPassword(app) {
  await app.waitFor(() => !!document.getElementById('vault-unlock-password'), [], { what: 'the unlock dialog' });
  await app.run((e) => e.fill(document.getElementById('vault-unlock-password'), 'not-the-master'));
  await sleep(50);
  await clickInDialog(app, 'Unlock');
  await app.waitFor(() => !!document.getElementById('vault-unlock-error'), [], { what: 'the wrong password to be refused' });
  await app.run((e) => e.fill(document.getElementById('vault-unlock-password'), 'e2e-master'));
  await sleep(50);
  await clickInDialog(app, 'Unlock');
  await app.waitFor(() => !document.getElementById('vault-unlock-password'), [], { what: 'the unlock dialog to close', timeoutMs: 10000 });
}

/** Opens a saved session's settings with its pencil, types an enable
 *  password on Credentials, and presses Save. */
async function editEnablePassword(app, name, password) {
  await app.run((e, n) => {
    const btn = document.querySelector(`button[aria-label="Edit ${n}"]`);
    btn.scrollIntoView();
    return e.click(btn);
  }, name);
  await app.waitFor(() => !!document.getElementById('new-session-modal-host-name-or-ip-address'), [], { what: 'the session editor' });
  await app.run((e) => e.click([...document.querySelectorAll('[role="tab"]')].find((x) => /Credentials/.test(x.textContent))));
  await app.waitFor(() => !!document.getElementById('new-session-modal-enable-password'), [], { what: 'the Enable password field' });
  // Opening Credentials with the vault locked asks at once; "Not now" defers it.
  await sleep(200);
  await app.run((e) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === 'Not now');
    if (b) e.click(b);
    return true;
  });
  await app.run((e, p) => e.fill(document.getElementById('new-session-modal-enable-password'), p), password);
  await sleep(50);
  await app.run((e) => {
    const b = [...document.querySelectorAll('button[type="submit"]')].find((x) => /Save (session|Changes)/.test(x.textContent));
    return e.click(b);
  });
}

async function clickInDialog(app, label) {
  await app.run((e, l) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === l);
    if (!b) throw new Error(`no "${l}" button`);
    return e.click(b);
  }, label);
}
