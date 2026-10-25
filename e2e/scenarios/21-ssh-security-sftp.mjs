import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startSshd, writePuttySession } from '../lib/fixtures.mjs';
import { clickButton, openSession } from '../lib/actions.mjs';

export const title = 'SSH trust decisions, failed authentication and SFTP integrity';

export async function setup({ home, defer }) {
  if (process.platform === 'win32') return { skip: 'needs a private Unix sshd', expectedSkip: true };
  try { execFileSync('psftp', ['-V'], { stdio: 'ignore' }); }
  catch (e) { if (e.code === 'ENOENT') return { skip: 'needs psftp' }; }
  const remote = path.join(home, 'remote files');
  fs.mkdirSync(remote);
  const sshd = await startSshd(path.join(home, 'sshd'), { sftp: true, sftpDir: remote });
  if (!sshd) return { skip: 'needs sshd, ssh-keygen and puttygen' };
  defer(() => sshd.stop());
  const settings = { HostName: '127.0.0.1', PortNumber: sshd.port, Protocol: 'ssh', UserName: os.userInfo().username, PublicKeyFile: sshd.ppk };
  writePuttySession(home, 'Transfer Server', settings);
  // A valid private key that this server has never authorized.
  const wrong = path.join(home, 'wrong-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', wrong]);
  execFileSync('puttygen', [wrong, '-o', `${wrong}.ppk`, '-O', 'private']);
  writePuttySession(home, 'Denied Server', { ...settings, PublicKeyFile: `${wrong}.ppk` });
  return { state: { sshd, remote } };
}

const hostQuestion = (app) => app.waitFor(() => document.querySelector('[aria-labelledby="hostkey-title"]')?.innerText, [], { what: 'the host key question', timeoutMs: 10000 });
const activeDisconnected = (app) => app.waitFor((e) => e.tabs().some((t) => t.active && t.status === 'disconnected'), [], { what: 'the rejected connection to disconnect', timeoutMs: 10000 });

export const tests = [
  ['rejecting an unknown SSH host disconnects without saving its key', async ({ app, sshd }) => {
    await openSession(app, 'Transfer Server');
    assert.ok((await hostQuestion(app)).includes(sshd.fingerprint));
    await clickButton(app, 'Abandon connection');
    await activeDisconnected(app);
    await clickButton(app, 'Reconnect');
    assert.match(await hostQuestion(app), /New host/);
    await clickButton(app, 'Trust and store key');
    await app.waitForScreen('e2e$');
  }],

  ['SFTP uploads and downloads preserve every byte, including binary data and spaced paths', async ({ app, remote, ctx }) => {
    const payload = Buffer.from(Array.from({ length: 65537 }, (_, i) => i % 256));
    const local = path.join(ctx.home, 'upload payload.bin');
    const destination = path.join(remote, 'remote payload.bin');
    const downloaded = path.join(ctx.home, 'download payload.bin');
    fs.writeFileSync(local, payload);
    // The real webview-to-backend IPC and psftp transport, with a native
    // file-picker choice supplied explicitly so the test remains headless.
    await app.invoke('sftp_upload', { sessionName: 'Transfer Server', localPath: local, remotePath: destination });
    assert.deepEqual(fs.readFileSync(destination), payload, 'uploaded bytes');
    await app.invoke('sftp_download', { sessionName: 'Transfer Server', remotePath: destination, localPath: downloaded });
    assert.deepEqual(fs.readFileSync(downloaded), payload, 'downloaded bytes');
    const entries = await app.invoke('sftp_list', { sessionName: 'Transfer Server', remotePath: remote });
    assert.ok(entries.some((e) => e.name === 'remote payload.bin'), 'uploaded file is listed');
  }],

  ['an unauthorized SSH key fails instead of leaving a live tab', async ({ app }) => {
    await openSession(app, 'Denied Server');
    await activeDisconnected(app);
    // The tab turns disconnected on plink's FATAL line, a moment before the
    // terminal has drawn it.
    await app.waitForScreen(/refused|authentication|authenticate|denied/i);
    assert.doesNotMatch(await app.screenText(), /^e2e\$/m);
  }],

  ['a changed host key warns with its new fingerprint and rejection preserves the old trust decision', async ({ app, sshd }) => {
    const oldFingerprint = sshd.fingerprint;
    await sshd.rotateHostKey();
    assert.notEqual(sshd.fingerprint, oldFingerprint);
    await openSession(app, 'Transfer Server');
    let question = await hostQuestion(app);
    assert.match(question, /host key has changed/);
    assert.ok(question.includes(sshd.fingerprint));
    await clickButton(app, 'Abandon connection');
    await activeDisconnected(app);
    // A rejected changed key intentionally suppresses automatic reconnect.
    await openSession(app, 'Transfer Server');
    question = await hostQuestion(app);
    assert.match(question, /host key has changed/, 'reject did not replace the stored key');
    await clickButton(app, 'I expected this: replace the key');
    await app.waitForScreen('e2e$');
  }],
];
