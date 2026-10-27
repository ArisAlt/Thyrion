import { setTimeout as delay } from 'node:timers/promises';
import { isWindows, killTree } from './windows.mjs';

// Wait for actual termination before another app takes the same profile/port.
export async function stopProcess(child, { group = false } = {}) {
  if (!child.pid) return;
  const signal = (name) => {
    try {
      if (isWindows) killTree(child.pid);
      else if (group) process.kill(-child.pid, name);
      else child.kill(name);
    } catch (e) { if (e.code !== 'ESRCH') throw e; }
  };
  signal('SIGTERM');
  const done = () => child.exitCode !== null || child.signalCode !== null;
  const deadline = Date.now() + 3000;
  while (!done() && Date.now() < deadline) await delay(25);
  if (!done()) {
    signal('SIGKILL');
    const deadline = Date.now() + 3000;
    while (!done() && Date.now() < deadline) await delay(25);
    if (!done()) throw new Error(`process ${child.pid} did not exit`);
  }
}
