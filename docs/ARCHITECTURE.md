# Thyrion's architecture

How Thyrion is built, what it is required to do, where it is weak, and what
to change next. Written from the code at v0.2.17 (2026-11-04) and updated
with the findings of two later code reviews (2026-11-06). File:line
references are to that code and drift as it changes; the names don't.

## 1. Requirements

**What it does**
- Opens PuTTY's saved sessions in tabs and split panes: SSH, telnet, raw,
  rlogin, serial and a local shell. It uses PuTTY's own store and its tools
  (plink, psftp).
- Manages sessions: folders, tags, editing, renaming, per-vendor logon
  actions, jump hosts, tunnels, host keys, X11 forwarding.
- Keeps passwords in an encrypted vault and sends them when the device asks:
  logins and enable passwords.
- Broadcast input, SFTP, session logs, scripts, snippets and keyword
  highlighting.
- Works as the GNS3 console handler (`--telnet host port --title`); a second
  launch hands its tabs to the window already open.

**How well** (the owner's bar: PuTTY is the standard)
- **Latency:** a key to its echo no slower than PuTTY. On the bench C891F at
  9600 baud the echo takes 7 ms.
- **Smoothness:** long output and pastes draw line by line and never freeze
  (SecureCRT is the reference). A serial paste goes at the device's echo
  pace.
- **Fidelity:** what Thyrion saves, PuTTY reads, and PuTTY's sessions open
  unchanged.
- **Privacy and security:** Thyrion connects only to the hosts the user
  opens. A password stays in the vault, never in PuTTY's files, and goes
  only to the host it belongs to.
- **Platforms:** Linux (AppImage, deb, rpm) and Windows (installer, MSI,
  portable). macOS is planned.

**Constraints**
- One maintainer, working with AI coding sessions.
- No budget for code signing.
- Compatibility with Plinky's names, commands and scripts.
- Tauri v2 (WebKitGTK on Linux, WebView2 on Windows) and xterm.js 5.5.

## 2. The parts and how data flows

```
 React page (WebView2 / WebKitGTK)                        ~17.7k lines TS
   App.tsx (tabs, panes, sessions list)  ── props ──>  TerminalView (xterm 5.5)
   module stores (localStorage + plinky:* events)      NewSessionModal, VaultManager, SFTP...
        │ invoke (68 commands)            ▲ Channel: raw output bytes (4 ms / 256 KB batches)
        ▼                                 │ ack_terminal_output (128 KB / 30 ms)
 src-tauri  (commands, managed state, events, CLI, single-instance)   ~3.3k lines
        │
        ▼
 plinky-core  SessionRegistry ── one Mutex<HashMap<id, ActiveSession>>   ~10.2k lines
   ActiveSession: transport, pre-auth state machine, 2 MiB scrollback,
                  FlowGate (512 KB window), log, expect/logon, paste echoes
   transports: plink (PTY) · local shell (PTY) · native telnet/raw · native serial
   vault (Argon2 + AES-GCM) · sftp (persistent psftp) · broadcast router
 putty-compat  PuTTY's own store: files on Linux, registry on Windows   ~2.1k lines
```

**Output**
1. The transport's thread reads the bytes and puts them on an unbounded
   channel.
2. One `OutputReader` task per session takes them in under the sessions
   lock: scrollback, the pre-auth state machine, log, expect and logon, and
   the paste echoes.
3. The bytes go to the page's channel, where `forward_output` batches them.
4. xterm draws them, the page acknowledges what it drew, and the `FlowGate`
   lets more through (a 512 KB window). A detached tab runs free into the
   scrollback and is replayed when it's shown again.

**Input**
- **A key:** `writeTerminalInput` (chained per tab) calls
  `write_terminal_input`, then `SessionRegistry::write_input`, which hands
  the bytes to the transport. Every transport writes from a thread of its
  own (`PtyWriter` for plink and the local shell, at most 4 MiB waiting), so
  nothing blocks under the lock.
- **A multi-line paste:** `paste_paced`, line by line. On serial each line
  waits for the previous one's echo.

**Storage**

| What | Where |
|---|---|
| Sessions | PuTTY's store (`~/.putty/sessions` files, or HKCU\Software\SimonTatham\PuTTY) |
| Thyrion's own per-session settings | `Plinky*` keys in that same session (PuTTY ignores them) |
| Passwords | the vault file (Argon2 + AES-GCM, magic "PLKV") |
| UI settings, layout, snippets, folder order | about 25 `plinky_*` localStorage keys |
| Logs | under `Thyrion Logs/` |

## 3. Details that matter

### Data model
- **`PuttySession`** has 7 first-class fields: name, host, port, user,
  protocol, key file and log file. Everything else lives in `extra`:
  PuTTY's own keys (Serial*, Proxy*, X11*, keepalives) and Thyrion's
  `Plinky*` keys (folder, tags, vault key, jump host, logon actions, look,
  paste delay, auto log, auto reconnect, auto login, auto enable). The
  `Plinky*` keys are read and written by hand, with no schema, so a typo
  silently becomes a new key.
- **The port field** is PuTTY's network port, 0 to 65535. A serial session's
  speed lives only in `SerialSpeed`. It used to go in the port too, so
  115200 couldn't be saved (fixed in PR #25).
- **Vault entries:** an id (usually `session:<name>`), username, secret,
  enable secret, notes and timestamps. A session names its entry in
  `PlinkyVaultKey`. Which entry a session uses is decided twice, in
  vault.rs and in vaultKeys.ts.

### Between the page and the backend
- **Commands:** 68 of them, all callable from the page. The page has a
  content security policy, so only Thyrion's own code runs in it (PR #24).
- **Output:** one raw-bytes Channel per session.
- **Events:** `session:ended`, `session:prompt`, `session:connected`,
  `paste:progress`, `script:*` and `cli:open`.
- **Wrappers:** the page calls the backend through about 90 near-identical
  functions. Some swallow errors and some throw.

### Where a password can go (the rules)
1. **Typed into the session by the backend** (`vault_send_secret`,
   `type_secret`), never returned to the page. The two exceptions are
   showing or copying an entry in the vault manager.
2. **Answered automatically only for something the user did in that tab:**
   - a console's login prompt, until the user has run a command;
   - an enable prompt right after the user typed `enable`.

   This state is kept per tab for the whole connection (consoleLogin.ts).
   It is never decided from replayed output, and a paste counts as
   commands run.
3. **Never through a jump host.** A saved session through PuTTY's SSH jump
   host (`ProxyMethod=6`) gets no `-pwfile`, in the terminal or in SFTP,
   because plink or psftp could offer the final host's password to the jump
   host. The jump host's own login is answered at its own prompt
   (jump_login.rs).

### Errors and retries
- **Auto-reconnect:** waits 2, 4, 8, 16, then 30 s, retrying through all
  five (fixed in PR #25; it stopped after the first).
- **FlowGate:** a 250 ms backstop, so a lost acknowledgement can't stall a
  session for good.
- **Pre-auth:** output before the login is over is capped at 64 KiB.
- **Paste:** a missing echo times out after 10 s, and Cancel stops it
  mid-paste.
- **Saving a session:** writes a `.bak`, then replaces the file in one step.
  A save that fails keeps the editor open with the reason (PR #25).
- **A session's end:** comes from the backend (`session:ended`, and
  Thyrion's own closing notices). plink's `FATAL ERROR:` counts only before
  the login is over (PR #25).

## 4. Scale and reliability

**Load**
- **Worst case:** a big GNS3 lab with 20 to 50 consoles open at once.
- **Backend scrollback:** a 2 MiB ring per session, so 100 MiB at 50 tabs.
- **Page scrollback:** xterm keeps every tab's terminal alive. Each keeps
  1,000 lines by default, up to 100,000 if set in Settings.
- **Threads:** per PTY session, a reader, a waiter and a writer, plus one
  async task. Native telnet and serial sessions have a reader and a writer.
  50 tabs come to roughly 150 to 200 threads, which is fine.
- **Output rates:** serial at 9600 baud is about 1 KB/s, and at 115200 about
  11.5 KB/s. An SSH `show tech-support` runs at several MB/s, held back by
  the 512 KB FlowGate window. In the renderer spike, the DOM renderer drew
  36 to 38 MB/s of coloured output and WebGL 53.
- **The limit to watch:** every output chunk and every write still takes
  the registry's single `sessions` lock. That's fine while nothing slow
  runs under it; since PR #24 no transport write blocks there.

**Failure and recovery**

| Failure | What happens |
|---|---|
| A device or link drops | `session:ended`; auto-reconnect if the session has it on |
| plink exits | the stream closes 200 ms after it; a notice goes in the scrollback |
| A session stops reading its input | its own writer waits; other tabs carry on; past 4 MiB waiting, input is refused and scripts wait |
| The page reloads, or a tab detaches | the session keeps running; output goes to scrollback, replayed on attach |
| Thyrion is killed (SIGKILL) | plink children may linger; serial `low_latency` stays on until the adapter is replugged |
| Corrupt layout state | backed up under `plinky_layout_corrupt_*`, then reset |
| The vault file is lost | sessions keep dangling `PlinkyVaultKey`s and still save their other settings |

**Monitoring:** none, by design (the privacy promise). For a problem
there's the tab's event log and the session logs. There's no "copy
diagnostics" yet.

## 5. Known design debt

Each item is scored as priority = (impact + risk) × (6 − effort), each part
1 to 5.

| # | Item | Type | Score | Status |
|---|---|---|---|---|
| 3.1 | PTY writes under the sessions lock froze every tab | Architecture | 32 | **Fixed**, PR #24 (writer thread, 4 MiB limit) |
| 3.2 | Windows-only code tested only with stand-ins for devices | Test | 30 | **Mitigated**, PR #24 (RELEASE-CHECKLIST.md) |
| 3.3 | Ctrl+F and Ctrl+Up/Down acted in every terminal | Code | 25 | **Fixed**, PR #24 |
| 3.4 | The page could do anything: no CSP; `vault_get`; `run_script` ran any path | Security | 24 | **Fixed**, PR #24. `vault_destroy` keeps working without the master password on purpose (the forgot-password reset). |
| 3.5 | Session editor: 40 useState, a load and a save mirrored key by key | Code | 24 | Open. Two bugs came from it: the vault prompt on a port change (PR #23) and 115200 baud (PR #25) |
| 3.6 | Vault-key rule written in Rust and in TypeScript | Code | 20 | Open |
| 3.7 | About 90 backend wrappers with mixed error handling | Code | 18 | Open. A silent failed save came from it (PR #25) |
| 3.8 | Protocol behaviour decided in three places; the session file read twice per start | Code | 16 | Open |
| 3.9 | ADRs cited in the code but missing; the architecture diagram out of date | Documentation | 16 | **Partly**: this file replaces the diagram; the ADRs are still missing |
| 3.10 | No "copy diagnostics" for bug reports | Infrastructure | 16 | Open |
| 3.11 | No tests for TerminalView as a unit, TunnelManager, HostKeyManager or SnippetParamsDialog | Test | 15 | Open |
| 3.12 | Settings in two patterns, 62 raw localStorage calls | Code | 12 | Open |
| 3.13 | About 50 `.lock().unwrap()`; errors mostly strings | Code | 12 | Open |
| 3.14 | Dead code: `dockview` used only in a stylesheet, `isFreeType`, `VaultState.custom_path`, `pub` test helpers | Code | 10 | Open |
| 3.15 | Serial output not charged to the FlowGate, yet acked against it | Code | 10 | Open |
| 3.16 | Pre-auth parser re-decodes up to 64 KiB per chunk | Code | 8 | Open |
| 3.17 | TerminalView: 1,589 lines, one 535-line effect | Architecture | 7 | Open. Scores low only because the fix is big |
| 3.18 | **Automatic actions decided from printed text**: credential answers and connection status read the output stream, which a device or a file on screen controls | Architecture/Security | 28 | **New** (2026-11-06). The cases found are fixed in PR #25; the rule is in section 3 |
| 3.19 | **SFTP had no review**: temporary files and passwords through a jump host | Security | 20 | **New**. The cases found are fixed in PR #25; reviewing the rest of sftp/ is open |

### What the later reviews found (2026-11-06)

All of these are fixed in PR #25. The finding numbers they confirm or add
are in brackets.

1. The console's password could go to an `ssh` started from the console,
   after a tab switch: the safeguard lived in the view and was replayed
   output was answered [3.18].
2. The same through a paste sent line by line, which skips xterm, where
   typed commands are seen [3.18].
3. `FATAL ERROR:` in a live session's output ended it, and auto-reconnect
   replaced a healthy connection [3.18].
4. Auto-reconnect stopped after the first failed retry.
5. Copying a vault password also showed it on screen.
6. Saving or moving a session restored the startup layout over the open
   tabs (a locked tab lost its unlock control).
7. Serial speeds of 115200 and up couldn't be saved [3.5].
8. A failed save closed the editor as if it had worked [3.7].
9. An SFTP download could overwrite or delete a file of the user's, and a
   long file name failed [3.19].
10. SFTP sent the final host's password through an SSH jump host [3.19].
11. CI never ran the unit tests.

**Lesson:** the first review predicted the editor and error-handling bugs
(3.5, 3.7) but missed two kinds: automation that trusts what the session
prints, and the SFTP subsystem, which it barely covered. Both are now
items, 3.18 and 3.19.

## 6. What to do next

**Phase 1** is done (PR #24) and the review fixes are in PR #25.

**Phase 2: as the code is touched**
- 3.18: anything Thyrion does by itself (send a password, reconnect, change
  a tab's status) is decided from backend events and the user's own input,
  never from output alone. Audit the remaining callers of
  `classifyPasswordPrompt` and `readOutputStatus` against the rule.
- 3.5: a pure `sessionForm` module. `fromPutty(session) → form` and
  `toPutty(form, previous) → { session, vaultPlan }`, where `vaultPlan` says
  what the vault must do: nothing, write, check or delete. Save carries out
  the plan, and every rule is a unit test.
- 3.19: review the rest of `sftp/`: uploads, deletes and remote paths.
- 3.7: one `call(cmd, args)` helper with one error policy.
- 3.6, 3.8, 3.9 (the ADRs), 3.10.

**Phase 3: opportunistic**
- 3.17: TerminalView split into hooks, one at a time (`useXterm`,
  `useSessionConnection`, `useOutputStatus`), each with tests (3.11).
- 3.12 to 3.16 when nearby code changes.

## 7. Trade-offs

- **One registry lock:** simple, and correct so far. Isolation between tabs
  holds only while nothing slow runs under it. The next step, if needed, is
  a lock per session (`Arc<Mutex<ActiveSession>>` in the map).
- **PuTTY's store as the database:** the core promise (no import; PuTTY
  sees everything). The cost: Thyrion's settings are flat strings in
  `extra`. That holds until settings need nesting or history; then a
  sidecar file per session.
- **No React state library or context:** plain and easy to follow. The cost
  is App.tsx at 30 useState and two ways of keeping settings. A small store
  per area (tabs and panes, settings) pays off around the next big UI
  feature.
- **DOM renderer on Linux, WebGL elsewhere:** measured on Linux only. On
  the DOM renderer, highlighting stands aside while output streams.
- **No telemetry:** it keeps the privacy promise and leaves bugs to user
  reports. That's why "copy diagnostics" (3.10) matters.

## 8. To revisit as it grows

- **macOS:** IOKit serial names, no `low_latency`, the WKWebView renderer
  default, signing.
- **A lab of 100+ tabs:** backend scrollback at 2 MiB each, and the xterm
  instances kept for hidden tabs. Consider dropping a hidden tab's xterm
  and replaying it from the backend.
- **More transports or a plugin API:** the `Transport` trait is ready, but
  the protocol rules (3.8) must be in one place first.
- **A second contributor:** the missing ADRs (3.9) and the session editor's
  mirrored load and save (3.5) would slow them most.
