// Things the app connects to during a run: stand-in router consoles that
// speak telnet and record every byte they receive, and a private sshd. They
// listen on 127.0.0.1 only and live as long as the run.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { isWindows, writeRegistrySession } from './windows.mjs';
import { stopProcess } from './process.mjs';

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;
const TTYPE = 24, TTYPE_IS = 0, TTYPE_SEND = 1;
const ECHO = 1, SGA = 3, NAWS = 31;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitUntil(check, { timeoutMs = 5000, what = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

// The running config `show running-config` prints. A few lines are traps
// for the pipe tests: a description that ends in a space, one with two
// spaces inside, one in Greek, and addresses a careless regex mixes up
// (10.1.1.1 and 10.11.1.1).
export const RUNNING_CONFIG = [
  'Building configuration...',
  '',
  'Current configuration : 1024 bytes',
  '!',
  'version 15.7',
  'hostname R1',
  '!',
  'interface Loopback0',
  ' description router id',
  ' ip address 10.255.0.1 255.255.255.255',
  '!',
  'interface GigabitEthernet0/0',
  ' description uplink to core ',
  ' ip address 10.1.1.1 255.255.255.252',
  '!',
  'interface GigabitEthernet0/1',
  ' description backup  link',
  ' ip address 10.1.2.1 255.255.255.252',
  '!',
  'interface GigabitEthernet0/2',
  ' description uplink to core-2',
  ' ip address 10.11.1.1 255.255.255.0',
  '!',
  'interface GigabitEthernet0/3',
  ' description Αθήνα γραφείο',
  ' no ip address',
  ' shutdown',
  '!',
  'ip access-list extended MGMT',
  ' permit tcp 10.0.0.0 0.255.255.255 any eq 22',
  ' deny   ip any any log',
  '!',
  'line vty 0 4',
  ' transport input ssh',
  ' login local',
  '!',
  'end',
];

const PIPE_FILTERS = ['include', 'exclude', 'begin', 'section', 'count'];

/** IOS's output filters, on output whose lines end in CR LF. */
export function filterOutput(out, kind, re) {
  const lines = out.split('\r\n');
  if (lines.at(-1) === '') lines.pop();
  let kept;
  if (kind === 'include') kept = lines.filter((l) => re.test(l));
  else if (kind === 'exclude') kept = lines.filter((l) => !re.test(l));
  else if (kind === 'begin') { const i = lines.findIndex((l) => re.test(l)); kept = i < 0 ? [] : lines.slice(i); }
  else if (kind === 'section') {
    // A matching line and the indented lines under it.
    kept = [];
    let inside = false;
    for (const l of lines) {
      if (!l.startsWith(' ')) inside = re.test(l);
      if (inside) kept.push(l);
    }
  } else return `Number of lines which match regexp = ${lines.filter((l) => re.test(l)).length}\r\n`;
  return kept.map((l) => `${l}\r\n`).join('');
}

/**
 * A router console on a telnet port, the way GNS3 serves one.
 *
 * `negotiate: true` behaves like IOS behind GNS3's console: it offers
 * WILL ECHO and WILL SUPPRESS-GO-AHEAD and asks for the window size, then
 * echoes what it is sent and edits the line itself. `negotiate: false` is a
 * console server that negotiates nothing (ser2net and similar), so the
 * client echoes and edits locally.
 *
 * Nothing is printed on connect: a router sitting at its prompt prints
 * nothing until it is sent Enter.
 */
export async function startConsole({ name = 'R1', negotiate = true, host = '127.0.0.1', onlyFrom = null, greet = false, mark = '>', replies = null, port = 0, enableSecret = null, patterns = [] } = {}) {
  const con = {
    name,
    received: Buffer.alloc(0), // data bytes, telnet commands removed
    commands: [],              // [verb, option] the client sent
    naws: [],                  // window sizes the client reported
    ttype: null,               // the terminal type it sent, as sent
    lines: [],                 // lines the console accepted
    connections: 0,
    open: 0,
    sockets: new Set(),
    enabled: false,            // in privileged mode (enableSecret)
    // The filter patterns the test will send, compiled here from the test's
    // own strings. What arrives only picks one: text from the socket never
    // becomes a regex, and a pattern that arrives changed (a lost trailing
    // space) is one the console does not know.
    patterns: new Map(),
  };
  con.addPattern = (p) => { con.patterns.set(p, new RegExp(p)); };
  patterns.forEach(con.addPattern);
  const userPrompt = `${name}${mark}`;
  let prompt = userPrompt;

  const handle = (sock) => {
    // Listening beyond this machine (a Windows VM on the LAN): one peer only.
    if (onlyFrom && sock.remoteAddress?.replace(/^::ffff:/, '') !== onlyFrom) { sock.destroy(); return; }
    con.connections++;
    con.open++;
    con.sockets.add(sock);
    sock.on('close', () => { con.open--; con.sockets.delete(sock); });
    sock.on('error', () => {});
    if (negotiate) sock.write(Buffer.from([IAC, WILL, ECHO, IAC, WILL, SGA, IAC, DO, NAWS]));
    // A device that shows its prompt on connect (an SSH login's shell, a
    // console server's banner), unlike a silent GNS3 console.
    if (greet) sock.write(Buffer.from(`\r\n${prompt}`, 'utf8'));

    let line = '';
    let lastWasCr = false;
    let state = 'data';
    let verb = 0;
    let sb = [];
    // With `enableSecret`, `enable` (en, super) asks "Password:" like IOS,
    // without echoing the answer; the right one gives the "#" prompt.
    let askingEnable = false;
    const say = (s) => sock.write(Buffer.from(s, 'utf8'));

    const accept = (text) => {
      con.lines.push(text);
      if (askingEnable) {
        askingEnable = false;
        if (text === enableSecret) { con.enabled = true; prompt = `${name}#`; say(`\r\n${prompt}`); }
        else say(`\r\n% Access denied\r\n\r\n${prompt}`);
        return;
      }
      const cmd = text.trim();
      if (enableSecret !== null && /^(?:en|ena|enab|enabl|enable|super)$/.test(cmd) && !con.enabled) {
        askingEnable = true;
        say('\r\nPassword: ');
        return;
      }
      if (enableSecret !== null && cmd === 'disable') { con.enabled = false; prompt = userPrompt; say(`\r\n${prompt}`); return; }
      if (cmd === 'exit') { say('\r\n'); sock.end(); return; }
      // `show ... | include|exclude|begin|section|count <regex>`, as IOS
      // filters output. The pattern is everything after the keyword, a
      // trailing space included; it must be one of `patterns`.
      const pipe = text.match(/^(.*?)\s\|\s*(\S+)(?:\s+(.*))?$/s);
      if (pipe) {
        const [, base, kind, pattern] = pipe;
        if (!PIPE_FILTERS.includes(kind)) { say(`\r\n% Invalid input detected at '^' marker.\r\n\r\n${prompt}`); return; }
        if (!pattern) { say(`\r\n% Incomplete command.\r\n\r\n${prompt}`); return; }
        const re = con.patterns.get(pattern);
        if (!re) { say(`\r\n% Unknown pattern (not given to startConsole): ${JSON.stringify(pattern)}\r\n${prompt}`); return; }
        say(`\r\n${filterOutput(answer(base.trim()), kind, re)}${prompt}`);
        return;
      }
      say(`\r\n${answer(cmd)}${prompt}`);
    };

    // What a command prints, before any filter.
    const answer = (cmd) => {
      let out = '';
      const big = cmd.match(/^show big (\d+)$/);
      if (big) {
        const n = Number(big[1]);
        const rows = [];
        for (let i = 1; i <= n; i++) rows.push(`line ${String(i).padStart(6, '0')} of ${n} ${'x'.repeat(40)}`);
        out = rows.join('\r\n') + `\r\nEND-OF-OUTPUT ${n}\r\n`;
      } else if (cmd === 'show trailing') {
        // As IOS prints some config lines: with a space on the end.
        out = 'ip dhcp pool LOCAL \r\n default-router 10.10.10.1 \r\nEND-TRAILING\r\n';
      } else if (cmd === 'show utf8') {
        out = 'Καλημέρα κόσμε ✓ — ψ\r\n';
      } else if (cmd === 'show size') {
        const s = con.naws.at(-1);
        out = s ? `size ${s.cols}x${s.rows}\r\n` : 'size unknown\r\n';
      } else if (/^show run(?:ning-config)?$/.test(cmd)) {
        out = RUNNING_CONFIG.map((l) => `${l}\r\n`).join('');
      } else if (cmd) {
        // `replies` lets the screenshot lab answer like a real device.
        out = replies?.(cmd) ?? `you typed: ${cmd}\r\n`;
      }
      return out;
    };

    const onData = (b) => {
      con.received = Buffer.concat([con.received, Buffer.from([b])]);
      if (b === 0x0d) {             // CR: end of line (CR LF or CR NUL follows)
        lastWasCr = true;
        const text = Buffer.from(line, 'latin1').toString('utf8');
        line = '';
        accept(text);
        return;
      }
      // CR LF, CR NUL and CR NUL LF are each one line end: a telnet server
      // reads CR NUL as CR (RFC 854), and a line ended CR LF is one Enter.
      if (b === 0x00 && lastWasCr) return;
      if (b === 0x0a && lastWasCr) { lastWasCr = false; return; }
      lastWasCr = false;
      if (b === 0x0a) {             // a bare LF also ends a line
        const text = Buffer.from(line, 'latin1').toString('utf8');
        line = '';
        accept(text);
        return;
      }
      if (b === 0x03) { line = ''; say(`^C\r\n${prompt}`); return; }
      if (b === 0x7f || b === 0x08) {
        if (line.length) {
          // Remove one UTF-8 character, not one byte.
          const chars = [...Buffer.from(line, 'latin1').toString('utf8')];
          chars.pop();
          line = Buffer.from(chars.join(''), 'utf8').toString('latin1');
          if (negotiate) say('\b \b');
        }
        return;
      }
      if (b === 0x1b || b < 0x20) return; // keys the stand-in does not edit with
      line += String.fromCharCode(b);
      if (negotiate && !askingEnable) sock.write(Buffer.from([b]));
    };

    sock.on('data', (chunk) => {
      for (const b of chunk) {
        if (state === 'data') {
          if (b === IAC) state = 'iac';
          else onData(b);
        } else if (state === 'iac') {
          if (b === IAC) { onData(IAC); state = 'data'; }
          else if (b === SB) { state = 'sb'; sb = []; }
          else if (b === WILL || b === WONT || b === DO || b === DONT) { verb = b; state = 'opt'; }
          else state = 'data';
        } else if (state === 'opt') {
          con.commands.push([{ [WILL]: 'WILL', [WONT]: 'WONT', [DO]: 'DO', [DONT]: 'DONT' }[verb], b]);
          // A client that offers its terminal type is asked for it, as IOS does.
          if (negotiate && verb === WILL && b === TTYPE) sock.write(Buffer.from([IAC, DO, TTYPE, IAC, SB, TTYPE, TTYPE_SEND, IAC, SE]));
          state = 'data';
        } else if (state === 'sb') {
          if (b === IAC) state = 'sb-iac';
          else sb.push(b);
        } else if (state === 'sb-iac') {
          if (b === SE) {
            if (sb[0] === NAWS && sb.length >= 5) {
              con.naws.push({ cols: (sb[1] << 8) | sb[2], rows: (sb[3] << 8) | sb[4] });
            }
            if (sb[0] === TTYPE && sb[1] === TTYPE_IS) con.ttype = Buffer.from(sb.slice(2)).toString('latin1');
            state = 'data';
          } else { sb.push(b); state = 'sb'; }
        }
      }
    });
  };

  const server = net.createServer(handle);
  try {
    await new Promise((r, j) => { server.once('error', j); server.listen(port, host, r); });
  } catch (e) { server.close(); throw e; }
  con.port = server.address().port;

  con.text = () => con.received.toString('latin1');
  con.clear = () => { con.received = Buffer.alloc(0); con.lines = []; };
  con.waitForBytes = (needle, opts = {}) => {
    const want = Buffer.isBuffer(needle) ? needle : Buffer.from(needle, 'utf8');
    return waitUntil(() => con.received.includes(want), { what: `${name} to receive ${JSON.stringify(want.toString('latin1'))}`, ...opts });
  };
  con.waitForLine = (text, opts = {}) =>
    waitUntil(() => con.lines.includes(text), { what: `${name} to receive the line ${JSON.stringify(text)}`, ...opts });
  con.hangUp = () => { for (const s of con.sockets) s.destroy(); };
  con.stop = () => new Promise((r) => { con.hangUp(); server.close(() => r()); });
  return con;
}

/**
 * A private sshd on a free port, logging in the current user with a key.
 * The shell it gives is a plain bash with a fixed prompt: the user's own
 * shell and dotfiles are not run.
 */
export async function startSshd(dir, { sftp = false, prompt = 'e2e$ ', sftpDir = null, port: wantPort = 0 } = {}) {
  const sshd = ['/usr/bin/sshd', '/usr/sbin/sshd', '/sbin/sshd'].find((p) => fs.existsSync(p));
  if (!sshd) return null;
  for (const tool of ['ssh-keygen', 'puttygen']) {
    try { execFileSync(tool, ['--help'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') return null; }
  }
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', f('host_key')]);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', f('client_key')]);
  fs.copyFileSync(f('client_key.pub'), f('authorized_keys'));
  execFileSync('puttygen', [f('client_key'), '-o', f('client_key.ppk'), '-O', 'private']);
  const fingerprint = () => execFileSync('ssh-keygen', ['-l', '-E', 'sha256', '-f', f('host_key.pub')]).toString().split(' ')[1];

  // ForceCommand replaces the sftp subsystem too; with `sftp` the
  // subsystem's own command, which sshd passes in SSH_ORIGINAL_COMMAND, is
  // run instead of the shell, started in `sftpDir` when given.
  const sftpServer = ['/usr/lib/openssh/sftp-server', '/usr/lib/ssh/sftp-server', '/usr/libexec/sftp-server']
    .find((p) => fs.existsSync(p));
  fs.writeFileSync(f('login.sh'), [
    '#!/bin/sh',
    sftp && sftpServer
      ? `case "$SSH_ORIGINAL_COMMAND" in *sftp-server*) exec ${sftpServer}${sftpDir ? ` -d '${sftpDir}'` : ''} ;; esac`
      : '',
    sftpDir ? `cd '${sftpDir}'` : '',
    `exec env PS1='${prompt}' HISTFILE=/dev/null /bin/bash --noprofile --norc -i`,
    '',
  ].join('\n'), { mode: 0o755 });

  const port = wantPort || await freePort();
  fs.writeFileSync(f('sshd_config'), [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${f('host_key')}`,
    `AuthorizedKeysFile ${f('authorized_keys')}`,
    `PidFile ${f('sshd.pid')}`,
    'StrictModes no',
    'UsePAM no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'PrintMotd no',
    'PrintLastLog no',
    ...(sftp && sftpServer ? [`Subsystem sftp ${sftpServer}`] : []),
    // A known shell and prompt, whatever the user's login shell is.
    `ForceCommand ${f('login.sh')}`,
    '',
  ].join('\n'));
  let child;
  const start = async () => {
    const log = fs.openSync(f('sshd.log'), 'a');
    child = spawn(sshd, ['-D', '-e', '-f', f('sshd_config')], { stdio: ['ignore', 'ignore', log] });
    fs.closeSync(log);
    let spawnError;
    child.on('error', (e) => { spawnError = e; });
    try {
      await waitUntil(() => {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null) throw new Error(fs.readFileSync(f('sshd.log'), 'utf8'));
        return new Promise((resolve) => {
          const socket = net.connect(port, '127.0.0.1', () => { socket.destroy(); resolve(true); });
          socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
          socket.on('error', () => resolve(false));
        });
      }, { what: 'sshd to listen', timeoutMs: 5000 });
    } catch (e) { await stopProcess(child); throw e; }
  };
  await start();
  return {
    port,
    get fingerprint() { return fingerprint(); },
    ppk: f('client_key.ppk'),
    log: () => fs.readFileSync(f('sshd.log'), 'utf8'),
    stop: () => stopProcess(child),
    async rotateHostKey() {
      await stopProcess(child);
      fs.unlinkSync(f('host_key'));
      fs.unlinkSync(f('host_key.pub'));
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', f('host_key')]);
      await start();
    },
  };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Writes a saved session where PuTTY keeps it: a file under `home` on
 *  Unix, the registry on Windows. */
export function writePuttySession(home, name, settings) {
  if (isWindows) return writeRegistrySession(name, settings);
  const dir = path.join(home, '.putty', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  const file = encodeURIComponent(name).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  fs.writeFileSync(path.join(dir, file), Object.entries(settings).map(([k, v]) => `${k}=${v}\n`).join(''));
}

/**
 * A router on a serial line: socat joins two pseudo-terminals, the app opens
 * one as its serial device, and this plays the router on the other. A router
 * console echoes what it is sent and prints nothing until Enter.
 */
export async function startSerialDevice(dir, { name = 'R9' } = {}) {
  try { execFileSync('socat', ['-V'], { stdio: 'ignore' }); } catch { return null; }
  fs.mkdirSync(dir, { recursive: true });
  const appSide = path.join(dir, 'ttyE2E0');
  const deviceSide = path.join(dir, 'ttyE2E1');
  const socat = spawn('socat', [`pty,raw,echo=0,link=${appSide}`, `pty,raw,echo=0,link=${deviceSide}`], { stdio: 'ignore' });
  let spawnError;
  socat.on('error', (e) => { spawnError = e; });
  try {
    await waitUntil(() => {
      if (spawnError) throw spawnError;
      if (socat.exitCode !== null) throw new Error('socat exited before creating PTYs');
      return fs.existsSync(appSide) && fs.existsSync(deviceSide);
    }, { what: 'socat ptys', timeoutMs: 5000 });
  } catch (e) { await stopProcess(socat); throw e; }

  const dev = { name, path: appSide, received: Buffer.alloc(0), lines: [] };
  let fd;
  try { fd = fs.openSync(deviceSide, fs.constants.O_RDWR | fs.constants.O_NOCTTY); }
  catch (e) { await stopProcess(socat); throw e; }
  const say = (s) => { try { fs.writeSync(fd, Buffer.from(s, 'utf8')); } catch { /* line gone */ } };
  let line = '';
  const stream = fs.createReadStream(null, { fd, autoClose: false });
  stream.on('error', () => {});
  stream.on('data', (chunk) => {
    for (const b of chunk) {
      dev.received = Buffer.concat([dev.received, Buffer.from([b])]);
      if (b === 0x0d || b === 0x0a) {
        if (b === 0x0a && dev.lastWasCr) { dev.lastWasCr = false; continue; }
        dev.lastWasCr = b === 0x0d;
        dev.lines.push(line);
        say(`\r\n${line ? `you typed: ${line}\r\n` : ''}${name}>`);
        line = '';
      } else if (b === 0x7f || b === 0x08) {
        if (line) { line = line.slice(0, -1); say('\b \b'); }
      } else if (b >= 0x20) {
        line += String.fromCharCode(b);
        say(String.fromCharCode(b));
      }
    }
  });
  dev.clear = () => { dev.received = Buffer.alloc(0); dev.lines = []; };
  dev.waitForLine = (text, opts = {}) =>
    waitUntil(() => dev.lines.includes(text), { what: `${name} to receive the line ${JSON.stringify(text)}`, ...opts });
  dev.waitForBytes = (s, opts = {}) =>
    waitUntil(() => dev.received.includes(Buffer.from(s)), { what: `${name} to receive ${JSON.stringify(s)}`, ...opts });
  /** The USB adapter pulled out: the line goes away. */
  let unplugging;
  dev.unplug = () => unplugging ??= (async () => {
    stream.destroy();
    await stopProcess(socat);
    try { fs.closeSync(fd); } catch { /* closed */ }
  })();
  dev.stop = dev.unplug;
  return dev;
}
