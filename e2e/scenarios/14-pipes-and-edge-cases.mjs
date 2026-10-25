// Output filters on a router console (`show running-config | include ...`)
// and the edge cases around them: regex characters, trailing and double
// spaces, typed and pasted, long lines, big output, several commands at
// once. The console filters like IOS (fixtures.mjs, filterOutput), so each
// test checks two things: the command reached the router byte for byte,
// and what came back is on screen, complete and in order.
import assert from 'node:assert/strict';
import { startConsole } from '../lib/fixtures.mjs';

export const title = 'Output filters (pipes) and typing edge cases on a console';

// Every filter pattern the tests send (the console only knows these).
const PATTERNS = [
  '^interface', '^!|^ |^$', '^line vty', '^interface GigabitEthernet0/1$', '10\\.1\\.(1|2)\\.[0-9]+ 255',
  'to core ', 'to core', 'backup  link', '^ ip address', '^!', '^router bgp', '^end', 'Αθήνα',
  '^line 0199', '^line 019995',
];

export async function setup({ defer }) {
  const r1 = await startConsole({ name: 'R1', patterns: PATTERNS });
  defer(() => r1.stop());
  return { args: ['--telnet', '127.0.0.1', String(r1.port), '--title', 'R1'], state: { r1 } };
}

const setClipboard = (app, text) => app.invoke('write_clipboard_text', { text });

// A unique line sent before a command. Its answer ("you typed: mark 3")
// marks where that command's output starts: the screen drops trailing
// spaces, so "include to core " echoes like an earlier "include to core",
// and on a slow runner the older one was read before the new echo drew.
let marks = 0;
async function mark(app, r1) {
  const m = `mark ${++marks}`;
  await app.run((e) => e.focusTerminal());
  await app.type(m);
  await app.key('Enter');
  await r1.waitForLine(m);
  return m;
}

// What the console printed for `cmd`, sent after mark `m`: the rows after
// its echo, up to the prompt that follows, as the screen shows them (no
// trailing spaces).
const outputOf = (app, cmd, m, opts = {}) => app.waitFor((e, answer, echo) => {
  const rows = e.screen() ?? [];
  const from = rows.lastIndexOf(answer);
  if (from < 0) return null;
  const rest = rows.slice(from + 1);
  const at = rest.indexOf(echo);
  if (at < 0) return null;
  const after = rest.slice(at + 1);
  const end = after.indexOf('R1>');
  return end < 0 ? null : after.slice(0, end);
}, [`you typed: ${m}`, `R1>${cmd}`.trimEnd()], { what: `the output of ${JSON.stringify(cmd)}`, ...opts });

// Types a command and Enter; returns its output once the router has the
// line exactly as typed.
async function run(app, r1, cmd) {
  const m = await mark(app, r1);
  await app.type(cmd);
  await app.key('Enter');
  await r1.waitForLine(cmd);
  return outputOf(app, cmd, m);
}

// Pastes with Ctrl+Shift+V; a paste of several lines is confirmed in the
// paste window (Paste has the focus).
async function paste(app, text) {
  await setClipboard(app, text);
  await app.run((e) => e.focusTerminal());
  await app.key('Ctrl+Shift+V');
  if (/\r|\n/.test(text.replace(/[\r\n]+$/, ''))) {
    await app.waitFor(() => !!document.querySelector('[aria-labelledby="paste-title"]'), [], { what: 'the paste window' });
    await app.key('Enter');
    await app.waitFor(() => !document.querySelector('[aria-labelledby="paste-title"]'), [], { what: 'the paste window to close' });
  }
}

export const tests = [
  ['the console wakes with Enter', async ({ app, r1 }) => {
    await app.waitFor((e) => e.tabs().some((t) => t.active && t.status === 'live'), [], { what: 'the console tab to be live', timeoutMs: 10000 });
    await app.run((e) => e.focusTerminal());
    await app.key('Enter');
    await r1.waitForLine('');
    await app.waitForScreen(/^R1>$/m);
  }],

  ['| include shows only the matching lines, in order', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show running-config | include ^interface');
    assert.deepEqual(out, [
      'interface Loopback0',
      'interface GigabitEthernet0/0',
      'interface GigabitEthernet0/1',
      'interface GigabitEthernet0/2',
      'interface GigabitEthernet0/3',
    ]);
  }],

  ['| exclude leaves out the matching lines', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show run | exclude ^!|^ |^$');
    assert.deepEqual(out, [
      'Building configuration...',
      'Current configuration : 1024 bytes',
      'version 15.7',
      'hostname R1',
      'interface Loopback0',
      'interface GigabitEthernet0/0',
      'interface GigabitEthernet0/1',
      'interface GigabitEthernet0/2',
      'interface GigabitEthernet0/3',
      'ip access-list extended MGMT',
      'line vty 0 4',
      'end',
    ]);
  }],

  ['| begin starts at the first match and runs to the end', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show running-config | begin ^line vty');
    assert.deepEqual(out, ['line vty 0 4', ' transport input ssh', ' login local', '!', 'end']);
  }],

  ['| section shows a block with the lines under it', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show running-config | section ^interface GigabitEthernet0/1$');
    assert.deepEqual(out, ['interface GigabitEthernet0/1', ' description backup  link', ' ip address 10.1.2.1 255.255.255.252']);
  }],

  ['| count answers with the number of matching lines', async ({ app, r1 }) => {
    assert.deepEqual(await run(app, r1, 'show running-config | count ^interface'), ['Number of lines which match regexp = 5']);
  }],

  ['regex characters reach the router byte for byte: \\ . ( | ) [ ] +', async ({ app, r1 }) => {
    // Escaped dots: 10.1.1.1 and 10.1.2.1, not 10.11.1.1.
    const cmd = 'show running-config | include 10\\.1\\.(1|2)\\.[0-9]+ 255';
    const out = await run(app, r1, cmd);
    assert.equal(r1.lines.at(-1), cmd);
    assert.deepEqual(out, [' ip address 10.1.1.1 255.255.255.252', ' ip address 10.1.2.1 255.255.255.252']);
  }],

  ['a typed trailing space reaches the router and narrows the match', async ({ app, r1 }) => {
    // "to core " (space) matches Gi0/0's description only; "to core" also
    // matches "to core-2". A terminal that dropped the space would answer
    // two lines.
    const out = await run(app, r1, 'show running-config | include to core ');
    assert.equal(r1.lines.at(-1), 'show running-config | include to core ', 'the space is still on the end');
    assert.deepEqual(out, [' description uplink to core']);
    assert.equal((await run(app, r1, 'show running-config | include to core')).length, 2);
  }],

  ['two spaces in a row stay two spaces', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show running-config | include backup  link');
    assert.equal(r1.lines.at(-1), 'show running-config | include backup  link');
    assert.deepEqual(out, [' description backup  link']);
  }],

  ['a pasted command keeps its trailing space', async ({ app, r1 }) => {
    const cmd = 'show running-config | include to core ';
    const m = await mark(app, r1);
    r1.clear();
    await paste(app, cmd);
    await r1.waitForBytes(cmd);
    await app.key('Enter');
    await r1.waitForLine(cmd);
    assert.deepEqual(await outputOf(app, cmd, m), [' description uplink to core']);
  }],

  ['a pasted config keeps every line\'s leading and trailing spaces, and its blank lines', async ({ app, r1 }) => {
    // IOS keeps a sub-command's indent, and a description's trailing space
    // is part of it. The paste window must not tidy either away.
    const lines = ['interface Loopback9 ', ' description lab  uplink ', '', ' no shutdown', 'end'];
    r1.clear();
    await paste(app, lines.join('\r\n') + '\r\n');
    await r1.waitForLine('end');
    assert.deepEqual(r1.lines, lines);
  }],

  ['several pasted pipe commands are each answered, in order', async ({ app, r1 }) => {
    const cmds = ['show run | count ^interface', 'show run | count ^ ip address', 'show run | count ^!'];
    r1.clear();
    await paste(app, cmds.join('\n') + '\n');
    await r1.waitForLine(cmds.at(-1));
    assert.deepEqual(r1.lines, cmds);
    const counts = await app.waitFor((e) => {
      const found = (e.screen() ?? []).map((r) => r.match(/^Number of lines which match regexp = (\d+)$/)?.[1]).filter(Boolean);
      return found.length >= 3 ? found.slice(-3) : null;
    }, [], { what: 'three counts' });
    assert.deepEqual(counts.map(Number), [5, 4, 9]);
  }],

  ['a pipe command wider than the terminal arrives whole', async ({ app, r1 }) => {
    const { cols } = await app.run((e) => e.termSize());
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima', 'mike'];
    let pattern = 'Loopback0';
    for (let i = 0; pattern.length < cols * 2; i++) pattern = `${words[i % words.length]}${i}|${pattern}`;
    const cmd = `show running-config | include ${pattern}`;
    r1.addPattern(pattern);
    await app.run((e) => e.focusTerminal());
    await app.type(cmd);
    await app.key('Enter');
    await r1.waitForLine(cmd, { timeoutMs: 10000 });
    await app.waitForScreen(/^interface Loopback0$/m);
  }],

  ['a filter that matches nothing prints nothing, and the prompt comes back', async ({ app, r1 }) => {
    assert.deepEqual(await run(app, r1, 'show running-config | include ^router bgp'), []);
  }],

  ['a mistyped filter shows the router\'s error, and the next command works', async ({ app, r1 }) => {
    const out = await run(app, r1, 'show running-config | grep core');
    assert.match(out.join('\n'), /% Invalid input detected/);
    assert.deepEqual(await run(app, r1, 'show running-config | count ^end'), ['Number of lines which match regexp = 1']);
  }],

  ['Greek in a filter reaches the router as UTF-8 and finds the Greek line', async ({ app, r1 }) => {
    assert.deepEqual(await run(app, r1, 'show running-config | include Αθήνα'), [' description Αθήνα γραφείο']);
  }],

  ['a filter over 20,000 lines of output answers with the right lines, in order', async ({ app, r1 }) => {
    assert.deepEqual(await run(app, r1, 'show big 20000 | count ^line 0199'), ['Number of lines which match regexp = 100']);
    const out = await run(app, r1, 'show big 20000 | begin ^line 019995');
    assert.deepEqual(out.map((l) => l.slice(0, 22)), [
      'line 019995 of 20000 x', 'line 019996 of 20000 x', 'line 019997 of 20000 x',
      'line 019998 of 20000 x', 'line 019999 of 20000 x', 'line 020000 of 20000 x', 'END-OF-OUTPUT 20000',
    ]);
  }, { timeoutMs: 40000 }],
];
