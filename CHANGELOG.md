# Changes

What changed in each Thyrion release, newest first. Each version's section
is also the notes on its page under
[Releases](https://github.com/ArisAlt/Thyrion/releases).

## v0.2.18

**Fixed**

- **A busy or stuck session no longer freezes every other tab.** Typing or
  pasting into an SSH or local-shell tab could stall all tabs at once when
  that session stopped reading its input (a big paste into a busy program,
  a slow network). Each session now takes its input on its own.
- **Ctrl+F and Ctrl+Up/Down act in the terminal you're in.** Search opened
  in every split pane and every hidden tab at once, and the prompt jumps
  moved them all.

**Security**

- **A content security policy for the app's window.** Only Thyrion's own
  code runs in it: a script from anywhere else is refused.
- **No way to read a password in plain text from the window.** An unused
  call that returned any saved password is gone.
- **Run Script runs only the file you pick** in its dialog.

**For maintainers**

- A [release checklist](docs/RELEASE-CHECKLIST.md) for what only real
  devices show: serial over FTDI and Cisco's USB console, the GPU renderer,
  telnet and SSH on Windows.

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
