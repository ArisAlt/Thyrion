// A saved PuTTY session to an SSH server, opened from the session list: the
// first-visit host key question, a key login, and what the remote shell sees.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { startSshd, writePuttySession, waitUntil } from '../lib/fixtures.mjs';

export const title = 'SSH to a saved session';

export async function setup({ home, runDir, defer }) {
  const sshd = await startSshd(path.join(runDir, 'sshd'));
  if (!sshd) return { skip: 'needs sshd, ssh-keygen and puttygen', expectedSkip: process.platform === 'win32' };
  defer(() => sshd.stop());
  writePuttySession(home, 'Lab Server', {
    HostName: '127.0.0.1',
    PortNumber: sshd.port,
    Protocol: 'ssh',
    UserName: os.userInfo().username,
    PublicKeyFile: sshd.ppk,
  });
  return { state: { sshd } };
}

// Runs a shell command and returns the screen text after its marker line.
async function shell(app, cmd, marker) {
  await app.run((e) => e.focusTerminal());
  await app.type(cmd);
  await app.key('Enter');
  await app.waitForScreen(marker, { timeoutMs: 5000 });
  return app.screenText();
}

const clickButton = (app, text) => app.waitFor((e, t) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t && e.visible(x));
  if (b) e.click(b);
  return !!b;
}, [text], { what: `a "${text}" button` });

export const tests = [
  ['the saved session is in the session list', async ({ app }) => {
    await app.waitFor(() => !!document.querySelector('[data-session-row="Lab Server"]'), [], { what: 'the session in the list' });
  }],

  ['opening it asks about the new host key and shows its real fingerprint', async ({ app, sshd }) => {
    await app.run((e) => e.dblclick(document.querySelector('[data-session-row="Lab Server"]')));
    const dialog = await app.waitFor(() => {
      const d = document.querySelector('[aria-labelledby="hostkey-title"]');
      return d ? d.innerText : null;
    }, [], { what: 'the host key question', timeoutMs: 8000 });
    assert.match(dialog, /New host/);
    assert.ok(dialog.includes(sshd.fingerprint), `the dialog shows ${sshd.fingerprint}:\n${dialog}`);
  }],

  ['trusting the key logs in with the saved key and the tab is ready', async ({ app }) => {
    await clickButton(app, 'Trust and store key');
    await app.waitForScreen('e2e$', { timeoutMs: 8000 });
    await app.waitForTab('Lab Server', 'live', { timeoutMs: 3000 });
  }],

  ['commands run and their output shows', async ({ app }) => {
    const screen = await shell(app, 'echo "answer=$((6*7))"', 'answer=42');
    assert.match(screen, /answer=42/);
  }],

  ['the remote shell is told the size the terminal shows', async ({ app }) => {
    const size = await app.run((e) => e.termSize());
    const screen = await shell(app, 'echo "size=$(stty size)"', /size=\d+ \d+/);
    const [, rows, cols] = screen.match(/size=(\d+) (\d+)/);
    assert.deepEqual({ rows: Number(rows), cols: Number(cols) }, size);
  }],

  ['TERM is xterm, like PuTTY', async ({ app }) => {
    // The answer's own line: /term=\S+/ also matched the command as typed
    // (`echo "term=$TERM"`), and on a fast CI runner the screen was read
    // before the shell had replied.
    const screen = await shell(app, 'echo "term=$TERM"', /^term=\S+/m);
    assert.match(screen, /term=xterm\b/);
  }],

  ['Ctrl+C stops a running command', async ({ app }) => {
    await app.run((e) => e.focusTerminal());
    await app.type('echo __RUNNING__; sleep 30; echo slept');
    await app.key('Enter');
    await app.waitForScreen(/^__RUNNING__$/m);
    const started = Date.now();
    await app.key('Ctrl+C');
    await app.waitFor((e) => {
      const lines = (e.screen() ?? []).filter((l) => l.trim());
      return lines.at(-1)?.startsWith('e2e$') && !lines.some((l) => l === 'slept');
    }, [], { what: 'the prompt back after Ctrl+C', timeoutMs: 3000 });
    assert.ok(Date.now() - started < 3000);
  }],

  // Pipes in the remote shell: the characters reach bash as typed, and a
  // pipeline's answer shows whole. Markers are the answer's own lines, so
  // the echoed command cannot match them.
  ['a pipeline over 20,000 lines answers with the right count', async ({ app }) => {
    const want = Array.from({ length: 20000 }, (_, i) => String(i + 1)).filter((n) => n.includes('7')).length;
    const screen = await shell(app, 'echo "count=$(seq 1 20000 | grep -c 7)"', /^count=\d+$/m);
    assert.equal(Number(screen.match(/^count=(\d+)$/m)[1]), want);
  }],

  ['trailing spaces typed into a pipeline reach the shell', async ({ app }) => {
    // cat -A marks each line's end with $, so the spaces before it show.
    const screen = await shell(app, "printf 'end  \\n' | cat -A", /^end {2}\$$/m);
    assert.match(screen, /^end {2}\$$/m);
  }],

  ['quotes, $, \\ and | inside quoted arguments reach the shell unchanged', async ({ app }) => {
    const screen = await shell(app, `echo 'a|b' "c\\$d" '"q"' 'e\\f' | tr '|' '_'`, /^a_b c\$d "q" e\\f$/m);
    assert.match(screen, /^a_b c\$d "q" e\\f$/m);
  }],

  ['a pipeline that fails part way reports it, and the shell stays usable', async ({ app }) => {
    const screen = await shell(app, 'false | cat; echo "status=${PIPESTATUS[0]}/${PIPESTATUS[1]}"', /^status=\d+\/\d+$/m);
    assert.match(screen, /^status=1\/0$/m);
    assert.match(await shell(app, 'echo "still=$((40+2))"', /^still=42$/m), /still=42/);
  }],

  ['a second connection does not ask about the key again', async ({ app }) => {
    await app.run((e) => e.dblclick(document.querySelector('[data-session-row="Lab Server"]')));
    await app.waitFor((e) => e.tabs().length === 2, [], { what: 'a second tab' });
    await app.waitForScreen('e2e$', { timeoutMs: 8000 });
    const asked = await app.run(() => !!document.querySelector('[aria-labelledby="hostkey-title"]'));
    assert.equal(asked, false, 'the stored key is used');
    await app.waitFor((e) => e.tabs().every((t) => t.status === 'live'), [], { what: 'both tabs ready' });
  }],

  ['switching tabs and back keeps both logged-in tabs ready', async ({ app }) => {
    // An SSH tab went amber ("waiting for login") after being switched back
    // to: the redraw on reattach was read as a new login prompt.
    for (let i = 0; i < 4; i++) {
      await app.run((e) => e.focusTerminal());
      const before = (await app.tabs()).find((t) => t.active).id;
      await app.key('Ctrl+Tab');
      await app.waitFor((e, id) => e.tabs().some((t) => t.active && t.id !== id), [before], { what: 'the other SSH tab to become active' });
    }
    const tabs = await app.tabs();
    assert.deepEqual(tabs.map((t) => t.status), ['live', 'live']);
  }],

  ['typing exit leaves the tab open, disconnected, with Reconnect', async ({ app }) => {
    // Unlike PuTTY, which closes the window on a clean exit: the tab stays,
    // so the session's output can still be read and reconnected from.
    const before = (await app.tabs()).length;
    await app.run((e) => e.focusTerminal());
    await app.type('exit');
    await app.key('Enter');
    await app.waitFor((e) => e.tabs().some((t) => t.active && t.status === 'disconnected'), [], { what: 'the tab to show disconnected' });
    assert.equal((await app.tabs()).length, before, 'the tab stays open');
    await app.waitFor((e) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Reconnect' && e.visible(b)), [], { what: 'a Reconnect button' });
  }],
];
