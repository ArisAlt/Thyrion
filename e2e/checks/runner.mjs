import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupScope, runSteps, selectTests } from '../lib/lifecycle.mjs';
import { CdpInspector } from '../lib/inspector.mjs';
import { startConsole } from '../lib/fixtures.mjs';

test('a filter keeps prerequisite steps but only reports requested successes', async () => {
  const calls = [];
  const selected = selectTests([
    ['prepare', () => calls.push('prepare')],
    ['paste', () => calls.push('paste')],
    ['later', () => calls.push('later')],
  ], 'console.mjs', 'paste');
  const results = await runSteps(selected, () => ({}));
  assert.deepEqual(calls, ['prepare', 'paste']);
  assert.deepEqual(results.map((r) => r.name), ['paste']);
  assert.equal(results[0].ok, true);
});

test('a failed prerequisite is reported and blocks the selected test', async () => {
  let ran = false;
  let cleaned = false;
  const steps = selectTests([
    ['prepare', () => { throw new Error('fixture failed'); }],
    ['paste', () => { ran = true; }],
  ], 'console.mjs', 'paste');
  const results = await runSteps(steps, () => ({}), { onFailure: async () => { cleaned = true; } });
  assert.equal(ran, false);
  assert.equal(cleaned, true);
  assert.equal(results[0].preparation, true);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].blocked, 'prepare');
});

test('a timed-out step closes resources before reporting and never starts its successor', async () => {
  const scope = cleanupScope();
  const order = [];
  scope.defer(() => order.push('closed'));
  const results = await runSteps([
    ['hang', () => new Promise(() => {}), { timeoutMs: 10 }],
    ['dependent', () => order.push('incorrectly ran')],
  ], () => ({}), {
    onFailure: () => scope.close(),
    onResult: () => order.push('reported'),
  });
  assert.match(results[0].error, /took longer/);
  assert.equal(results[1].blocked, 'hang');
  assert.deepEqual(order, ['closed', 'reported', 'reported']);
  assert.throws(() => scope.defer(() => {}), /already ended/);
});

test('partial setup releases a real listening socket', async () => {
  const scope = cleanupScope();
  const con = await startConsole();
  scope.defer(() => con.stop());
  try { throw new Error('later setup failed'); } catch { await scope.close(); }
  const socket = net.connect(con.port, '127.0.0.1');
  const [error] = await once(socket, 'error');
  assert.equal(error.code, 'ECONNREFUSED');
});

test('cleanup attempts every resource in reverse order even after a cleanup failure', async () => {
  const scope = cleanupScope();
  const order = [];
  scope.defer(() => order.push('first'));
  scope.defer(() => { order.push('second'); throw new Error('cleanup error'); });
  scope.defer(() => order.push('third'));
  await assert.rejects(scope.close(), AggregateError);
  await scope.close();
  assert.deepEqual(order, ['third', 'second', 'first']);
});

test('closing the inspector rejects outstanding and late commands without waiting for the socket', async () => {
  const sent = [];
  const inspector = new CdpInspector({ send: (s) => sent.push(s), close: () => {} });
  const pending = inspector.evaluate('1');
  inspector.close();
  await assert.rejects(pending, /closed/);
  await delay(1);
  await assert.rejects(inspector.evaluate('2'), /closed/);
  assert.equal(sent.length, 1);
  assert.equal(inspector.pending.size, 0);
});

test('an unmatched CLI filter fails before trying to launch a missing binary', () => {
  const result = spawnSync(process.execPath, ['e2e/run.mjs', '--only', 'no-such-e2e-test-79a19', '--binary', '/nonexistent/e2e'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no matching tests/);
  assert.doesNotMatch(result.stderr, /no app at/);
});

test('a CLI filter requires a value instead of consuming the next flag', () => {
  const result = spawnSync(process.execPath, ['e2e/run.mjs', '--only', '--keep'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--only needs a value/);
});
