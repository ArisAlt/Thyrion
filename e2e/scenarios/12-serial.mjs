// A saved serial session, to a router on the other end of the line.
import assert from 'node:assert/strict';
import path from 'node:path';
import { startSerialDevice, writePuttySession } from '../lib/fixtures.mjs';

export const title = 'Serial console, from a saved session';

export async function setup({ home, runDir, defer }) {
  const dev = await startSerialDevice(path.join(runDir, 'serial'));
  if (!dev) return { skip: 'needs socat', expectedSkip: process.platform === 'win32' };
  defer(() => dev.stop());
  writePuttySession(home, 'Console Cable', {
    Protocol: 'serial', SerialLine: dev.path, SerialSpeed: 9600,
    SerialDataBits: 8, SerialStopHalfbits: 2, SerialParity: 0, SerialFlowControl: 0,
  });
  return { state: { dev } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const tests = [
  ['a serial session opens ready, though the router prints nothing', async ({ app }) => {
    await app.waitFor(() => !!document.querySelector('[data-session-row="Console Cable"]'), [], { what: 'the session in the list' });
    await app.run((e) => e.dblclick(document.querySelector('[data-session-row="Console Cable"]')));
    await app.waitForTab('Console Cable', 'live', { timeoutMs: 3000 });
  }],

  ['Enter sends CR, like PuTTY on a serial line, and the prompt shows', async ({ app, dev }) => {
    await app.run((e) => e.focusTerminal());
    dev.clear();
    await app.key('Enter');
    await dev.waitForBytes('\r');
    await sleep(150);
    assert.equal(JSON.stringify(dev.received.toString('latin1')), JSON.stringify('\r'));
    await app.waitForScreen('R9>');
  }],

  ['typing is echoed once, by the router', async ({ app, dev }) => {
    dev.clear();
    await app.type('show version');
    await app.key('Enter');
    await dev.waitForLine('show version');
    await app.waitForScreen('you typed: show version');
    const screen = await app.screen();
    assert.equal(screen.filter((l) => l.includes('R9>show version')).length, 1, screen.join('\n'));
  }],

  ['Backspace sends DEL (0x7f), like PuTTY', async ({ app, dev }) => {
    dev.clear();
    await app.key('Backspace');
    await dev.waitForBytes(Buffer.from([0x7f]));
    assert.deepEqual([...dev.received], [0x7f]);
  }],

  ['a typed key is on screen within a frame or two of the echo', async ({ app, dev }) => {
    // The device echoes at once here, so this is Thyrion's own path: the
    // key to the line, the echo to the page, the page to the screen. On a
    // real Cisco console at 9600 baud the echo itself takes 7-14 ms.
    const took = await app.run(async (e) => {
      const rows = [...document.querySelectorAll('.xterm')].find(e.visible).querySelector('.xterm-rows');
      const times = [];
      for (const ch of 'abcdefghij') {
        times.push(await new Promise((resolve) => {
          const before = rows.textContent;
          const t0 = performance.now();
          const mo = new MutationObserver(() => {
            if (rows.textContent !== before) { mo.disconnect(); resolve(performance.now() - t0); }
          });
          mo.observe(rows, { subtree: true, childList: true, characterData: true });
          e.type(ch);
          setTimeout(() => { mo.disconnect(); resolve(Infinity); }, 2000);
        }));
      }
      for (let i = 0; i < 10; i++) e.key('Backspace');
      return times.sort((a, b) => a - b);
    });
    assert.ok(took[5] < 60, `median key to screen ${took[5]} ms (all: ${took.join(', ')})`);
    assert.ok(took[9] < 250, `slowest key to screen ${took[9]} ms`);
  }],

  ['a multi-line paste goes one line at a time, each after the last one is echoed', async ({ app, dev }) => {
    // A console sent a paste flat out falls behind its own echo and drops
    // lines (a real C891F lost 1 line in 10, through PuTTY 1 in 5).
    const lines = Array.from({ length: 30 }, (_, i) => `interface GigabitEthernet0/${i} description e2e paste ${'x'.repeat(i)}`);
    await app.invoke('write_clipboard_text', { text: lines.map((l) => `${l}\n`).join('') });
    dev.clear();
    await app.run((e) => e.focusTerminal());
    await app.key('Ctrl+Shift+V');
    await app.waitFor(() => !!document.querySelector('[aria-labelledby="paste-title"]'), [], { what: 'the paste window' });
    const summary = await app.run(() => document.getElementById('paste-summary').textContent);
    assert.match(summary, /as the device echoes each/);
    await app.key('Enter');
    await dev.waitForLine(lines.at(-1), { timeoutMs: 15000 });
    await sleep(200);
    assert.deepEqual(dev.lines, lines);
    await app.waitForScreen(`you typed: ${lines.at(-1)}`);
  }],

  ['a serial tab restored at startup leaves its line alone until Connect', async ({ app, dev, ctx }) => {
    // The app started again with the tab in its saved layout, while the line
    // is in use (here by the first app: a console script or another
    // terminal in real life). Opening it at startup took it from them.
    await sleep(500); // the layout is saved
    const again = await ctx.launch({});
    try {
      await again.waitForTab('Console Cable', 'disconnected', { timeoutMs: 10000 });
      await again.waitForScreen('was not reopened at startup');
      assert.equal(await again.run(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Connect')), true, 'a Connect button');
      // The line is still the first app's: what it types gets there.
      dev.clear();
      await app.run((e) => e.focusTerminal());
      await app.type('show clock');
      await app.key('Enter');
      await dev.waitForLine('show clock');
      // Connect opens it, and here says it's busy rather than taking it.
      await again.run((e) => e.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Connect')));
      await again.waitForScreen(/Failed to open serial line[\s\S]*busy/i, { timeoutMs: 10000 });
    } finally {
      await again.stop();
    }
  }],

  ['pulling out the USB adapter shows the tab as disconnected', async ({ app, dev }) => {
    await dev.unplug();
    await app.waitForTab('Console Cable', 'disconnected', { timeoutMs: 5000 });
  }],
];
