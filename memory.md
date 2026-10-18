# Project Memory & Context

Read this first at the start of every task. Update it when a feature lands, a
decision is made or a rule is set. Keep bullets short; prune what is done or stale.
Last updated: 2026-10-18 (v0.2.6).

## Core Purpose & Stack
- Thyrion (named Plinky until 0.2.0): a desktop terminal and session manager on top of PuTTY, for sysadmins and network engineers. Linux and Windows; macOS planned/on hold.
- PuTTY does the SSH work: `plink` connects, `psftp` transfers files. Thyrion never implements SSH. Telnet/raw consoles are native (`transport/telnet.rs`); serial is native too (for Send Break).
- Reads and writes PuTTY's own saved sessions: `~/.putty/sessions` or `PUTTYDIR` on Linux, the registry on Windows. Nothing to import.
- Stack: Tauri v2 shell (`src-tauri/`), React 19 + TypeScript + xterm.js + dockview + Tailwind (`src/`), Vite, Vitest.
- Cargo workspace: `crates/plinky-core` (PTY, sessions, transports, broadcast routing), `crates/putty-compat` (PuTTY session store, registry, .ppk headers, host keys), `src-tauri` (app: `cli.rs`, `handoff.rs`, `lib.rs`, `scripts.rs`; Python helpers in `src-tauri/scripting/`).
- Identifier `com.thyrion.desktop`. License GPL-3.0-only (≤0.1.4 was MIT/Apache-2.0).
- Repo: github.com/ArisAlt/Thyrion (origin now `ArisAlt/thyrion.git`, formerly `ArisAlt/Plinky`). Default branch `master`.
- Website: separate repo ArisAlt/Web-Thyrion, cloned at `~/Dev/Web-Thyrion`, live at https://www.thyrion.io. It has its own notes (AGENTS.md, past_memory.md).

## Architectural Rules & Standards
- Developer guide: `docs/DEVELOPMENT.md` (architecture, build, tests, CLI). Password handling: `docs/PASSWORDS.md`; reporting: `SECURITY.md`. Update them when behaviour changes.
- Checks before shipping: `npm test`, `npm run build`, `cargo test --workspace`, `cargo deny check`, `npm run e2e -- --build` (Linux, hidden screen; `--only <name>` to filter).
- e2e scenarios live in `e2e/scenarios/NN-name.mjs`. Tests named "like PuTTY" expect PuTTY's default behaviour. They run in a throwaway home, never touching real sessions or vault.
- CLI arguments are untrusted: hosts or users starting with `-` are refused, titles are cleaned and capped at 80 characters. GNS3: `thyrion --telnet {host} {port} --title "{name}"`. A second launch hands its tabs to the running window.
- Compatibility kept from Plinky: `plinky` / `plinky-desktop` commands and `from plinky import session` still work. Don't break them.
- Commit style: conventional prefixes (`feat:`, `fix:`, `fix(windows):`, `test(e2e):`, `ci:`, `docs:`), messages describe the user-visible effect. Releases are commits named `release: vX.Y.Z`.
- Releases: `.github/workflows/release.yml` on tags (or manual dispatch). Windows signing through SignPath, used only once `SIGNPATH_API_TOKEN` is set.
- README pictures are made from the real app: `node e2e/shots.mjs <outDir> [stills|gif]`.

## Active Tasks & Roadmap
- Website copy is behind v0.2.6: www.thyrion.io says "Ten interface themes" (now five) and doesn't mention automatic session logs. Fix in Web-Thyrion `site/index.html`.
- Website (user, in dashboards): turn on Cloudflare "Always Use HTTPS" (http://www.thyrion.io still serves 200); submit the sitemap and request indexing in Search Console.
- SignPath signing: waiting on the project's acceptance; set the secrets once it's approved.
- Not planned for v1: `.ppk` decryption, an in-app SSH agent, Zmodem.
- Remote branches `feat/auto-log`, `feat/more-themes`, `test/session-management` are fully merged into master; they can be deleted (ask first).

## Learned Context & Workarounds
- Linux without a GPU render node: the app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` (avoids a ~700 ms paint stall). Set it to `0` to keep the renderer.
- Packaging on CachyOS/Arch: `NO_STRIP=true cargo tauri build` (linuxdeploy's strip fails on `.relr.dyn`).
- Telnet through plink.exe on Windows had no local echo, a fixed 80x24 window, and lost input after Ctrl+Z. That's why telnet is native; `THYRION_TELNET_VIA_PLINK=1` restores the old path.
- Local `wrangler` is logged in to the user's Cloudflare account: `wrangler preview` / `deploy` publish for real. For checks use `wrangler deploy --dry-run` or `wrangler dev`.
- The Claude desktop app's pinned origin for this repo is still `ArisAlt/Plinky`, so its "sync with base branch" refuses. Re-pin it in Help → Troubleshooting → Review Pinned Git Origins, or fast-forward by hand.
