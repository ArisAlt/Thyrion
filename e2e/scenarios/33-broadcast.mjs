import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startConsole } from '../lib/fixtures.mjs';
import { clickButton, fill } from '../lib/actions.mjs';

export const title = 'Broadcast channel and locked-tab isolation';
export async function setup({ defer }) {
  const consoles = [];
  for (const name of ['BA1', 'BA2', 'BB1']) {
    const con = await startConsole({ name });
    defer(() => con.stop());
    consoles.push(con);
  }
  return {
    args: consoles.flatMap((c) => ['--telnet', '127.0.0.1', String(c.port), '--title', c.name]),
    state: { consoles },
  };
}

async function send(app, command) {
  await fill(app, '[aria-label="Broadcast command"]', command);
  await app.run((e) => e.click(document.querySelector('[aria-label="Broadcast command"]').closest('form').querySelector('button[type="submit"]')));
}

export const tests = [
  ['broadcasting to channel A reaches its two tabs once and leaves channel B untouched', async ({ app, consoles }) => {
    for (const con of consoles) {
      await app.waitForTab(con.name, 'live');
      await app.run((e, name) => e.click(e.tabEl(name)), con.name);
      await app.waitFor((e, name) => e.tabs().some((t) => t.title === name && t.active), [con.name]);
      await app.run((e) => e.click([...document.querySelectorAll('button[title^="Broadcast channel:"]')].find(e.visible)));
      const channel = con.name.startsWith('BA') ? 'A' : 'B';
      await app.waitFor((e) => e.visible(document.querySelector('[role="menu"][aria-label="Broadcast channel"]')));
      await app.run((e, channel) => e.click([...document.querySelectorAll('[role="menu"][aria-label="Broadcast channel"] button')]
        .find((b) => b.textContent.includes(`Channel ${channel}`))), channel);
      await app.waitFor((e, channel) => [...document.querySelectorAll('button[title^="Broadcast channel:"]')]
        .some((b) => e.visible(b) && b.textContent.trim() === `Channel: ${channel}`), [channel]);
    }
    await clickButton(app, 'CH-A');
    for (const c of consoles) c.clear();
    await send(app, 'show broadcast-one');
    await Promise.all(consoles.slice(0, 2).map((c) => c.waitForLine('show broadcast-one')));
    // Bounded observation is intentional for absence/duplicate assertions.
    await delay(300);
    assert.deepEqual(consoles.map((c) => c.lines), [['show broadcast-one'], ['show broadcast-one'], []]);
    assert.equal(consoles[2].received.length, 0);
  }],

  ['locking one channel-A tab excludes it from the next broadcast', async ({ app, consoles }) => {
    await app.run((e) => e.rightClick(e.tabEl('BA2')));
    await clickButton(app, 'Lock (read only)', '[role="menuitem"]');
    await app.waitFor((e) => e.tabEl('BA2').dataset.tabLocked === 'true');
    for (const c of consoles) c.clear();
    await send(app, 'show broadcast-two');
    await consoles[0].waitForLine('show broadcast-two');
    await delay(300);
    assert.deepEqual(consoles.map((c) => c.lines), [['show broadcast-two'], [], []]);
    assert.equal(consoles[1].received.length, 0, 'locked peer received no bytes');
    assert.equal(consoles[2].received.length, 0, 'other channel received no bytes');
  }],
];
