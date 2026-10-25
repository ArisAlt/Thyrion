#!/usr/bin/env node
// End-to-end tests: the real app, its real backend and PuTTY's real plink,
// against stand-in router consoles and a private sshd, on a screen nobody
// sees. Unit tests stub the terminal, the backend or the network; most of the
// bugs that reached users were in the joins between them, which only this
// catches.
//
//   node e2e/run.mjs --build          build the app for testing, then run
//   node e2e/run.mjs                  run against the last test build
//   node e2e/run.mjs --only paste     only tests whose name contains "paste"
//   node e2e/run.mjs --visible        show the windows on your desktop
//   node e2e/run.mjs --keep           keep the test profiles for inspection
//   node e2e/run.mjs --strict-skips   fail if required fixtures are missing (default in CI)
//
// Linux and Windows (Windows on a CI runner only: lib/windows.mjs). Needs
// Node 22+, plink, and on Linux kwin_wayland or Xvfb; the
// SSH tests also need sshd, ssh-keygen and puttygen, and skip without them.
//
// The app under test is a debug build (see --build): WebKit's inspector,
// which the suite drives the page through, is only on in debug builds.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDisplay } from './lib/display.mjs';
import { launchApp } from './lib/app.mjs';
import { cleanupScope, selectTests, runSteps } from './lib/lifecycle.mjs';
import { isWindows, resetProfile, assertThrowawayMachine, testBuildConfig } from './lib/windows.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return argv[i + 1];
};
const only = option('--only')?.toLowerCase();
const binary = path.resolve(option('--binary') ?? path.join(root, `target/debug/thyrion${isWindows ? '.exe' : ''}`));

const color = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, yellow: (s) => s };

function preflight() {
  if (process.platform !== 'linux' && !isWindows) throw new Error('the end-to-end suite runs on Linux and Windows');
  if (isWindows) assertThrowawayMachine();
  if (typeof WebSocket === 'undefined') throw new Error(`Node 22 or newer is needed (this is ${process.version})`);
  try { execFileSync('plink', ['-V'], { stdio: 'ignore' }); } catch (e) {
    if (e.code === 'ENOENT') throw new Error('plink is not on PATH: install PuTTY');
  }
  if (flag('--build')) {
    console.log(color.dim('building the app for testing (debug, frontend embedded)...'));
    // Test-only native close permission enables genuine restart tests.
    // On Windows the overlay also opens WebView2's DevTools port.
    const extra = ['--config', testBuildConfig(path.join(root, 'src-tauri/tauri.conf.json'), path.join(os.tmpdir(), 'thyrion-e2e.conf.json'))];
    // npx is npx.cmd on Windows, which Node starts only through a shell.
    const r = spawnSync('npx', ['tauri', 'build', '--debug', '--no-bundle', '--ignore-version-mismatches', ...extra], {
      cwd: root, stdio: ['ignore', 'inherit', 'inherit'], shell: isWindows,
    });
    if (r.status !== 0) throw new Error('the build failed');
  }
  if (!fs.existsSync(binary)) throw new Error(`no app at ${binary}: run with --build first`);
  // A plain `cargo build` binary loads the page from the Vite dev server
  // and shows a blank window without it. Only `tauri build --debug` embeds it.
  const age = (Date.now() - fs.statSync(binary).mtimeMs) / 3600e3;
  if (age > 24) console.log(color.yellow(`note: the app under test was built ${Math.round(age)} h ago; --build rebuilds it`));
}

async function main() {
  // Select before preflight/build/display startup: a typo must not be a green
  // run, and discovering it should not need a desktop build.
  const selected = [];
  for (const file of fs.readdirSync(path.join(here, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort()) {
    const scenario = await import(pathToFileURL(path.join(here, 'scenarios', file)));
    const tests = selectTests(scenario.tests, file, only);
    if (tests.length) selected.push({ file, scenario, tests });
  }
  if (!selected.length) throw new Error(`no matching tests${only ? ` for --only ${JSON.stringify(only)}` : ''}`);
  preflight();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thyrion-e2e-'));
  let display;
  const results = [];
  try {
    display = await startDisplay({ runDir, visible: flag('--visible') });
    console.log(color.dim(`app: ${path.relative(root, binary)}   screen: ${display.kind}   files: ${runDir}`));
    for (const { file, scenario, tests } of selected) {
      console.log(`\n${scenario.title}`);
      const home = fs.mkdtempSync(path.join(runDir, `${path.basename(file, '.mjs')}-`));
      const scope = cleanupScope();
      let app;
      let prepared;
      const ctx = {
        home, runDir, binary, display, defer: scope.defer,
        async launch(opts = {}) {
          if (scope.closed) throw new Error('the scenario has already ended');
          const next = await launchApp({ binary, display, home, ...opts, onStart: scope.defer });
          if (scope.closed) { await next.stop(); throw new Error('the scenario ended during launch'); }
          return next;
        },
        async restart() {
          await app.closeWindow();
          await app.stop();
          app = await ctx.launch({ env: prepared.env ?? {} });
          return app;
        },
      };
      const report = (result) => {
        results.push({ file, ...result });
        if (result.ok) console.log(`  ${color.green('✓')} ${result.name} ${color.dim(`${result.durationMs} ms`)}`);
        else if (result.blocked) console.log(color.yellow(`  blocked: ${result.name} (after ${result.blocked})`));
        else {
          console.log(color.red(`  ✗ ${result.name}${result.preparation ? ' (required preparation)' : ''}`));
          console.log(indent(color.red(result.error), 6));
          if (result.scene) console.log(indent(color.dim(result.scene), 6));
        }
      };
      try {
        if (isWindows) resetProfile();
        prepared = await scenario.setup(ctx);
        if (prepared.skip) {
          // CI's Linux job installs all fixtures. Windows explicitly lacks
          // sshd and serial PTYs; only declared platform skips are accepted.
          const unexpected = (process.env.CI === 'true' || flag('--strict-skips')) && !prepared.expectedSkip;
          for (const [name, , , shown] of tests) if (shown) {
            if (unexpected) report({ name, ok: false, error: `unexpected skip: ${prepared.skip}` });
            else results.push({ file, name, skipped: prepared.skip });
          }
          console.log(color.yellow(`  skipped: ${prepared.skip}`));
          continue;
        }
        app = await ctx.launch({ args: prepared.args ?? [], env: prepared.env ?? {} });
        await runSteps(tests, () => ({ app, ...prepared.state, ctx }), {
          onResult: report,
          onFailure: async (result) => {
            result.scene = await snapshot(app);
            try { await scope.close(); } catch (e) {
              result.error += `\nCleanup errors: ${e.errors ?? e}`;
            }
          },
        });
      } catch (e) {
        for (const [name, , , shown] of tests) if (shown && !results.some((r) => r.file === file && r.name === name)) {
          report({ name, ok: false, error: `scenario failed: ${e.stack ?? e}` });
        }
      } finally {
        try { await scope.close(); } catch (e) {
          report({ name: 'cleanup', ok: false, error: String(e.errors ?? e) });
        }
      }
    }
  } finally {
    await display?.stop();
    if (!flag('--keep')) fs.rmSync(runDir, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.skipped).length;
  const blocked = results.filter((r) => r.blocked).length;
  console.log(`\n${passed} passed, ${failed.length} failed, ${blocked} blocked, ${skipped} skipped`);
  for (const f of failed) console.log(color.red(`  ✗ ${f.name}`));
  if (flag('--keep')) console.log(color.dim(`profiles and logs kept in ${runDir}`));
  process.exitCode = failed.length || blocked ? 1 : 0;
}

async function snapshot(app) {
  try {
    const s = await app.run((e) => ({ tabs: e.tabs(), dialogs: e.dialogs(), screen: e.screen() }));
    const screen = (s.screen ?? []).filter((l) => l.trim()).slice(-12).join('\n');
    return [
      `tabs: ${s.tabs.map((t) => `${t.title}[${t.status}${t.active ? ',active' : ''}]`).join(' ') || '(none)'}`,
      s.dialogs.length ? `dialogs: ${s.dialogs.join(' | ').slice(0, 300)}` : null,
      screen ? `screen (last lines):\n${indent(screen, 2)}` : null,
    ].filter(Boolean).join('\n');
  } catch {
    return app.exited ? `the app exited (${JSON.stringify(app.exited)}); log: ${app.log}` : null;
  }
}

const indent = (s, n) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');

main().catch((e) => { console.error(color.red(e.message)); process.exitCode = 2; });
