# Thyrion

**A desktop terminal and session manager built on PuTTY.**

Thyrion is for system administrators, network engineers and anyone who works
over SSH, telnet or serial consoles. PuTTY's own tools make the SSH
connections and transfer the files; Thyrion adds tabs, split screens, a file
browser, a password vault and a few everyday time-savers.

It uses the sessions you have already saved in PuTTY, so there is nothing to
import. Sessions you add or change in Thyrion are saved in the same place, so
PuTTY sees them too.

![Thyrion with a lab open: the session tree on the left, and four device consoles (two routers, two switches) in a 2x2 grid, each showing interface, OSPF and VLAN output](docs/images/thyrion-workflow.png)

*Saved sessions in folders on the left, four device consoles side by side.*

![A backup server's shell beside the SFTP browser, local files on one side and the server's config backups on the other](docs/images/thyrion-sftp.png)

*A server's shell next to its files: drag, double-click or use the arrows to
move them.*

![GNS3 runs Thyrion once per node; each console opens as a tab in the same window, commands run in each, then the four are shown in a 2x2 grid](docs/images/thyrion-gns3.gif)

*GNS3's "Console to all nodes": each device arrives as a tab in the window
that is already open. Set GNS3's console command to
`thyrion --telnet {host} {port} --title "{name}"`.*

*Thyrion was called Plinky until version 0.2.0. See
[Coming from Plinky](#coming-from-plinky).*

---

## What you can do with it

- **Open your PuTTY sessions in tabs.** The same saved sessions you use in
  PuTTY, organised in folders and subfolders, with tags and search.
- **Work side by side.** Split the window into two or four terminals, with a
  file browser next to your shell.
- **Type into several servers at once.** Group tabs into broadcast channels and
  send one command to all of them.
- **Move files without leaving the terminal.** A two-pane file browser for
  uploads, downloads and remote folders.
- **Keep passwords in an encrypted vault.** Log in automatically, including
  through a jump host. A session's enable password sits next to its login
  password, and is sent when the device asks or when you press Ctrl+Shift+E.
  Passwords stay in the vault, not in PuTTY's session files.
  [How your passwords are protected](docs/PASSWORDS.md).
- **Reach hosts behind a gateway.** Connect through a jump host / bastion with
  one setting.
- **Work with network gear.** Serial console sessions with USB adapter
  detection and Send Break. A paste on a serial line goes line by line, each
  line once the device has echoed the last, so a slow console keeps up.
- **Copy and paste with the mouse, like PuTTY.** Selecting text copies it, a
  middle click (the scroll wheel) pastes, and a right click opens the menu or
  pastes, as you choose. A paste of several lines shows you the text first.
  All of it is in Settings > Mouse & Clipboard.
- **Use it as GNS3's console.** Set GNS3's custom console command to
  `thyrion --telnet {host} {port} --title "{name}"` and every device opens as
  a tab in one Thyrion window.
- **Save time.** Reusable command snippets with fill-in values, highlighted IPs
  and keywords, clickable links, and point-and-click cursor editing.
- **Keep a record.** Log any session straight to a file as it happens, or
  have every session logged automatically, each connection to its own file:
  `Thyrion Logs/<folder>/<session>/<date_time>.log`. Turn it on for all
  sessions in Settings > Logging, or per session in its settings.
- **Manage tunnels and host keys** from one place.
- **Make it yours.** Five interface themes (Thyrion, two darker ones
  including true black, and two classic light looks),
  seventeen terminal colour schemes, and programming fonts built in, so they
  work offline.

---

## Platforms

- **Linux:** AppImage, `.deb` and `.rpm`
- **Windows:** installer and portable `.exe`

macOS is planned for later.

Thyrion uses the PuTTY you already have installed, so install
[PuTTY](https://www.chiark.greenend.org.uk/~sgtatham/putty/) first.

## Download

Get the latest version from the
[Releases page](https://github.com/ArisAlt/Thyrion/releases).

### Checking a download

Every file on the Releases page is built from this repository by GitHub
Actions. Releases after v0.2.13 also have a `SHA256SUMS.txt` with the
checksum of every file, and GitHub keeps a signed record of which workflow and
commit built each one. To check a file you downloaded:

```bash
# Built by this repository's release workflow? (GitHub CLI)
gh attestation verify Thyrion_<version>_x64-setup.exe --repo ArisAlt/Thyrion

# Matches the published checksum? (Linux; in the folder with SHA256SUMS.txt)
sha256sum -c SHA256SUMS.txt --ignore-missing
```

On Windows, `Get-FileHash .\Thyrion_<version>_x64-setup.exe` prints the checksum
to compare with the file's line in `SHA256SUMS.txt`.

The Windows installers aren't code-signed yet (see below), so Windows
SmartScreen may say "Windows protected your PC" and show the publisher as
unknown. Choose **More info**, then **Run anyway**.

---

## Code signing policy

Windows releases are to be signed through SignPath's program for open-source
projects, from the first release after the project is accepted:

Free code signing provided by [SignPath.io](https://about.signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/).

- Every release is built from this repository by GitHub Actions
  ([release.yml](.github/workflows/release.yml)); nothing built anywhere else
  is signed.
- Committers and reviewers: [ArisAlt](https://github.com/ArisAlt).
- Approvers (each signing request is approved by hand):
  [ArisAlt](https://github.com/ArisAlt).

Privacy: Thyrion connects only to the hosts you open sessions to. It sends
nothing anywhere else unless you ask it to.

---

## Known bugs

Found and confirmed, not fixed yet:

- **Telnet or raw to an IPv6 address in brackets fails.** A saved telnet or
  raw session whose host is `[2001:db8::1]` reports "Host does not exist".
  Write the address without the brackets: `2001:db8::1`.
- **Tunnels with an IPv6 destination are misread.** In the Tunnels panel, a
  port forward to `[::1]:8080` shows the wrong host and port, and so does a
  forward with a listening address (`127.0.0.1:8080=…`) or PuTTY's `4`/`6`
  prefix. They still work when the session connects; edit them in PuTTY.
- **Switching a tunnel off deletes it.** PuTTY's session has no "off" for a
  port forward, so a forward switched off in the Tunnels panel is gone after
  a restart. Add it again to turn it back on.
- **A script can outlive its tab.** A script that isn't reading from or
  typing into its session when the tab closes, or when Thyrion quits (for
  example one in a `sleep`), keeps running until it next uses the session.
  A script waiting on the session ends at once. Press Stop before closing.
- **SFTP: a name ending in spaces loses them.** Such a file is listed without
  its trailing spaces, and downloading or deleting it fails.
- **A PuTTY version Thyrion can't read shows as missing.** With a `plink`
  whose version isn't in the usual form (a development snapshot), the title
  bar says PuTTY is missing, although sessions work.

---

## Reporting problems

Bugs and ideas: [open an issue](https://github.com/ArisAlt/Thyrion/issues/new/choose).
Security problems: privately, as described in [SECURITY.md](SECURITY.md).

---

## License

Thyrion is free software under the [GNU General Public License v3.0](LICENSE)
(GPL-3.0-only). You may use, share and change it. If you distribute Thyrion or
a modified version, you must do so under the same license, with its source
code.

For a commercial license, for example to use Thyrion's code in a closed-source
product, contact the maintainer through GitHub.

Versions up to and including 0.1.4 were published under MIT or Apache-2.0;
copies of those versions keep those terms.

---

## Coming from Plinky

Thyrion is Plinky, renamed in 0.2.0. Nothing is lost:

- **Your passwords and settings come along.** On its first start Thyrion
  copies Plinky's vault, snippets, folders, layout and settings into its own
  folder. Plinky's folder is left as it was.
- **Your sessions are where they were**, in PuTTY's own store.
- **Linux:** installing the Thyrion package replaces Plinky's. The commands
  `plinky` and `plinky-desktop` still work and start Thyrion, so a GNS3
  console command written for Plinky keeps working; new ones can use
  `thyrion --telnet {host} {port} --title "{name}"`.
- **Windows:** Thyrion installs as its own app. Point GNS3's console command
  at Thyrion, then uninstall Plinky when you're ready.
- **Scripts** that start with `from plinky import session` keep working;
  new ones can use `from thyrion import session`.

---

## The name, and Alis

Thyrion (Θύριον) was a town in ancient Acarnania, in western Greece. Its name
comes from θύρα, a door, and in networking a *port*: fitting for a tool that
opens doors to consoles and remote machines.

Thyrion's mascot is **Alis**, the maintainer's dog. In memory of a very good
dog.

<sub>Developers: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).</sub>
