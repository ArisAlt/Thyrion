"""Helper for scripts run from Thyrion (right-click a terminal, Run Script).

Thyrion connects the script to one session: what the script prints goes to
the device, what the device prints comes in on the script's input, and what
the script writes to stderr shows in the terminal as a note. This module
wraps that in a few calls:

    from thyrion import session

    session.send("terminal length 0")
    session.wait_for_prompt()
    config = session.command("show running-config")
    session.log(f"got {len(config)} characters")

command() sends a line and waits for the device's own prompt (learned as it
goes, "R1#" or "R1(config)#"), answers --More-- pagers on the way, and
returns the output without the echoed command or the prompt.

Thyrion puts this file on the script's PYTHONPATH; nothing to install.
"""

import os
import re
import sys
import threading
import time

__all__ = ["session", "Session"]

# A prompt at the end of the output: "R1#", "R1>", "user@host:~$ ",
# "[admin@fw] >", "% ". At the very end: a line of `show running-config`
# that ends in # or > is not the prompt.
DEFAULT_PROMPT = r"[>#$%]\s?\Z"

# Where a pager stops for a key: IOS, NX-OS, EOS " --More-- ", Junos
# "---(more 42%)---", Comware and VRP "  ---- More ----", ProCurve
# "-- MORE --, next page: Space, next line: Enter, quit: Control-C".
# Whole, and still for SETTLE: at 9600 baud " --More-- " comes in pieces.
PAGER = re.compile(r"[ \t]*(?:-{2,} ?\(?more(?: \d+%)?\)? ?-{2,}|-- ?MORE ?--[^\r\n]*)[ \t]*\Z", re.IGNORECASE)
# What a pager prints after the key to erase itself: backspaces, spaces and
# as many backspaces again over it (IOS), or a carriage return over spaces
# (Junos). It can come in pieces, and what follows can start with spaces.
PAGER_ERASE = re.compile(r"\A(?:(\x08+) +\1|\r +\r)")
# A network device's prompt, to learn its name from: "R1#", "R1(config-if)#",
# "user@mx1>", "<HUAWEI>".
NETWORK_PROMPT = re.compile(r"^(?P<name>[^\s()#>$%]+?)(?:\([^)]*\))?[#>]$")
# Output that has stopped at a prompt gets this long to show there is more.
SETTLE = 0.1


class Session:
    def __init__(self):
        self.name = os.environ.get("PLINKY_SESSION", "")
        self._buf = ""
        self._cond = threading.Condition()
        self._closed = False
        # The device's prompt, learned from the last command() (see prompt()).
        self._prompt = None
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        # The raw descriptor, not sys.stdin: a thread blocked inside the
        # buffered reader holds its lock, and Python then dies at exit with
        # "could not acquire lock for <stdin>".
        fd = sys.stdin.fileno()
        while True:
            try:
                data = os.read(fd, 4096)
            except (OSError, ValueError):
                data = b""
            with self._cond:
                if not data:
                    self._closed = True
                    self._cond.notify_all()
                    return
                self._buf += data.decode("utf-8", errors="replace")
                self._cond.notify_all()

    def send(self, text, enter=True):
        """Types `text` into the session, then Enter unless enter=False."""
        data = text + ("\r" if enter else "")
        sys.stdout.buffer.write(data.encode("utf-8"))
        sys.stdout.buffer.flush()

    def expect(self, pattern, timeout=30):
        """Waits until `pattern` (a regular expression) shows in the output.

        Returns everything up to and including the match, and forgets it, so
        the next expect() looks only at what came after. Raises TimeoutError
        after `timeout` seconds, with what did arrive in the message.
        """
        rx = re.compile(pattern, re.MULTILINE)
        deadline = time.monotonic() + timeout
        with self._cond:
            while True:
                m = rx.search(self._buf)
                if m:
                    seen, self._buf = self._buf[: m.end()], self._buf[m.end():]
                    return seen
                left = deadline - time.monotonic()
                if left <= 0 or self._closed:
                    tail = self._buf[-200:]
                    raise TimeoutError(f"no {pattern!r} after {timeout} s; last output: {tail!r}")
                self._cond.wait(left)

    def wait_for_prompt(self, prompt=DEFAULT_PROMPT, timeout=30):
        """Waits for the device's prompt and returns what came before it.

        The prompt has to be at the end of the output and stay there for a
        moment: output that stops for a moment after a line ending in # or >
        is not the prompt yet.
        """
        with self._cond:
            return self._until_prompt(re.compile(prompt, re.MULTILINE), timeout, pager=False)

    def read(self, quiet=0.5, timeout=30):
        """Returns output once none has arrived for `quiet` seconds."""
        deadline = time.monotonic() + timeout
        with self._cond:
            while time.monotonic() < deadline:
                size = len(self._buf)
                self._cond.wait(quiet)
                if len(self._buf) == size or self._closed:
                    break
            out, self._buf = self._buf, ""
            return out

    def prompt(self):
        """The device's prompt as command() last saw it ("R1#"), or None."""
        return self._prompt

    def _prompt_pattern(self):
        # The learned prompt's name, in any mode: "R1#" also matches
        # "R1(config)#" and "R1>". A shell's "user@host:~$" changes with the
        # directory: any prompt at the end will do there.
        learned = self._prompt or ""
        # Huawei VRP and Comware: "<HUAWEI>", and in system view "[HUAWEI]"
        # or "[HUAWEI-GigabitEthernet0/0/1]".
        vrp = re.match(r"^[<\[](?P<name>[^\s<>\[\]-]+)(?:-[^\]>]*)?[>\]]$", learned)
        if vrp:
            return re.compile(r"(?:\A|[\r\n])[<\[]" + re.escape(vrp.group("name")) + r"(?:-[^\]>\r\n]*)?[>\]]\s?\Z")
        m = NETWORK_PROMPT.match(learned)
        if not m:
            return re.compile(DEFAULT_PROMPT)
        return re.compile(r"(?:\A|[\r\n])" + re.escape(m.group("name")) + r"(?:\([^)\r\n]*\))?[#>]\s?\Z")

    def _until_prompt(self, rx, timeout, pager=True):
        # What comes until `rx` matches at the end and stays there for
        # SETTLE, answering pagers on the way. Called with the lock held.
        deadline = time.monotonic() + timeout
        out = ""
        answer_pager = pager
        while True:
            pager = answer_pager and PAGER.search(self._buf)
            if pager:
                size = len(self._buf)
                self._cond.wait(SETTLE)
                if len(self._buf) != size:
                    continue  # more came: not stopped there after all
                out += self._buf[: pager.start()]
                self._buf = ""
                self.send(" ", enter=False)
                # A stray backspace that never becomes an erase: not for long.
                erase_by = min(deadline, time.monotonic() + 1.0)
                while time.monotonic() < erase_by and not self._closed:
                    if self._buf:
                        erase = PAGER_ERASE.match(self._buf)
                        if erase:
                            self._buf = self._buf[erase.end():]
                            break
                        if self._buf[0] not in "\x08\r":
                            break  # a pager that doesn't erase itself
                    self._cond.wait(min(SETTLE, max(deadline - time.monotonic(), 0)))
                continue
            if rx.search(self._buf):
                size = len(self._buf)
                self._cond.wait(SETTLE)
                if len(self._buf) == size and rx.search(self._buf):
                    out, self._buf = out + self._buf, ""
                    return out
                continue
            left = deadline - time.monotonic()
            if left <= 0 or self._closed:
                tail = (out + self._buf)[-200:]
                raise TimeoutError(f"no prompt after {timeout} s; last output: {tail!r}")
            self._cond.wait(left)

    def command(self, cmd, prompt=None, timeout=60):
        """Runs `cmd` and returns its output: no echoed command, no prompt.

        Waits for the device's own prompt (learned from the last command:
        "R1#", also in another mode, "R1(config)#"), or `prompt`, a regular
        expression, at the end of the output. A --More-- pager on the way is
        answered with a space, and left out of what is returned.
        """
        rx = re.compile(prompt, re.MULTILINE) if prompt else self._prompt_pattern()
        with self._cond:
            self._buf = ""
        self.send(cmd)
        with self._cond:
            seen = self._until_prompt(rx, timeout)
        lines = seen.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        if lines:
            last = lines[-1].strip()
            if NETWORK_PROMPT.match(last) or re.search(DEFAULT_PROMPT, last) or re.match(r"^\[[^\s\]]+\]$", last):
                self._prompt = last
            lines = lines[:-1]  # the prompt
        if lines and _echo_of(cmd, lines[0]):
            lines = lines[1:]
        return "\n".join(lines)

    def log(self, *parts):
        """Shows a note in the terminal. It is not sent to the device."""
        print(*parts, file=sys.stderr, flush=True)


def _echo_of(cmd, line):
    """Whether `line` is the device's echo of `cmd`. IOS redraws a line
    wider than the terminal from a `$`, with spaces and backspaces between
    the pieces: compared without those, the command's end is there."""
    shown = lambda t: re.sub(r"[\s\x08$]", "", t)
    want = shown(cmd)
    return bool(want) and shown(line).endswith(want[-12:])


session = Session()
