# Changes

What changed in each Thyrion release, newest first. Each version's section
is also the notes on its page under
[Releases](https://github.com/ArisAlt/Thyrion/releases).

## v0.2.19

**Fixed**

- **Hints in text boxes are readable on the light themes.** About half the
  boxes (passwords, the jump host, the vault's form, the SFTP filter,
  terminal search) showed their hint in a fixed grey that no theme changed:
  barely visible on Classic Light and Classic Grey. They follow the theme
  now.
- **Status colours are readable everywhere on the light themes.** Blue,
  green, red and amber text fell just short on the grey panels and window
  background; it was checked against the white surface only.
- **Black text shows in the terminal on the light themes.** With "Match
  interface", black was the same white as the background. Blue and yellow
  text there were a little faint too.
- **The snippet editor behaves like the other windows.** Escape closes it,
  and Ctrl+Tab or Ctrl+Shift+W no longer act on the tabs behind it while you
  type. The same goes for the snippet's values window and the two log
  windows.
- **The vault says "1 item"**, not "1 items".
- **The pane's tab chooser in split view shows keyboard focus**, and screen
  readers no longer read the status bar's separators.

## v0.2.18

**Fixed**

- **A busy or stuck session no longer freezes every other tab.** Typing or
  pasting into an SSH or local-shell tab could stall all tabs at once when
  that session stopped reading its input (a big paste into a busy program,
  a slow network). Each session now takes its input on its own.
- **Ctrl+F and Ctrl+Up/Down act in the terminal you're in.** Search opened
  in every split pane and every hidden tab at once, and the prompt jumps
  moved them all.
- **Serial sessions save at 115200 baud and faster.** The speed also went
  into the session's network port, which can't hold it, so the save was
  refused.
- **A session that couldn't be saved says so.** The settings window closed
  as if it had worked; now it stays open and shows why.
- **Saving or moving a session keeps your open tabs as they are.** It
  reloaded the tabs saved at startup over them, and a locked tab lost its
  unlock button.
- **Text on screen can't end a session.** A log or file shown in a live
  session with "FATAL ERROR:" in it marked the tab disconnected, and with
  automatic reconnect on, Thyrion closed the connection and opened another.
- **Automatic reconnect keeps trying.** It stopped after the first retry
  that failed; it now makes every retry it's set to.
- **SFTP downloads leave your files alone.** A file already named like the
  download's temporary file was overwritten, or deleted when the download
  failed; and a file with a very long name couldn't be downloaded.

**Security**

- **A console's password goes only to that console.** With "log in
  automatically" on, the password could reach a host you had started from
  the console (an `ssh`): after switching away from the tab and back, or
  after pasting the commands that started it. Thyrion now answers only
  what the console itself asks, for the whole connection.
- **No password goes through a jump host from the file browser.** For a
  session through an SSH jump host, the file browser could offer the final
  host's password to the jump host; it now sends none there (log in to such
  a host with a key to browse its files).
- **Copying a vault password doesn't show it.** Copy put the password on
  screen as well, and it stayed there after the clipboard was cleared.

- **A content security policy for the app's window.** Only Thyrion's own
  code runs in it: a script from anywhere else is refused.
- **No way to read a password in plain text from the window.** An unused
  call that returned any saved password is gone.
- **Run Script runs only the file you pick** in its dialog.

**For maintainers**

- A [release checklist](docs/RELEASE-CHECKLIST.md) for what only real
  devices show: serial over FTDI and Cisco's USB console, the GPU renderer,
  telnet and SSH on Windows.
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): how Thyrion is built, where a
  password may go, and the known design debt with what to change next.
- CI runs the page's unit tests on every pull request.

## v0.2.17

**Fixed**

- **Changing a saved session's settings works with the vault locked.**
  Changing the COM port of a serial session (or the host of an SSH session,
  or any other setting) whose login is kept in the vault asked for the
  master password, saying the password would be written to the vault,
  though no password had been touched. Cancelling it saved nothing, with
  nothing said, so Save Changes seemed to do nothing. Now the change is
  saved straight away and the session keeps its login. The vault is asked
  for only when a password is typed or removed, or the session is pointed at
  a different vault entry. ([#23](https://github.com/ArisAlt/Thyrion/pull/23))
