# Changes

What changed in each Thyrion release, newest first. Each version's section
is also the notes on its page under
[Releases](https://github.com/ArisAlt/Thyrion/releases).

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
