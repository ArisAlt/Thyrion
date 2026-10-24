"""Tests for thyrion.py's session.command(), against a stand-in Cisco IOS.

Run from this folder: python3 -m unittest test_thyrion (scripts.rs runs it
from cargo test). Not shipped: the app embeds thyrion.py itself.
"""

import json
import os
import subprocess
import sys
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))

# A config like a C891F's: lines that end in # or >, which are not prompts.
CONFIG = ["Building configuration...", "", "Current configuration : 4296 bytes", "!"] + [
    f"interface GigabitEthernet{i}\n description to core-{i}>\n no ip address\n!" for i in range(12)
] + ["banner motd #", "Authorised users only", "#", "line vty 0 4", " transport input ssh", "!", "end"]
CONFIG = "\n".join(CONFIG).split("\n")
WIDE = "show running-config | include interface GigabitEthernet|description to core-1|no ip address"


class FakeIOS:
    """Plays the device on the script's other end: echoes what it is sent,
    and on Enter answers like IOS, with a pager at 24 lines."""

    def __init__(self, proc):
        self.proc = proc
        self.prompt = "R1#"
        self.line = ""
        self.paging = None  # lines still to show after --More--
        threading.Thread(target=self.run, daemon=True).start()

    def say(self, text, pause_after=None):
        try:
            self.proc.stdin.write(text.encode())
            self.proc.stdin.flush()
        except (BrokenPipeError, ValueError):
            pass

    def run(self):
        while True:
            b = self.proc.stdout.read(1)
            if not b:
                return
            c = b.decode()
            if self.paging is not None:
                if c == " ":
                    self.say("\x08" * 9 + " " * 8 + "\x08" * 9)
                    self.page()
                continue
            if c == "\r":
                cmd, self.line = self.line, ""
                self.say("\r\n")
                self.answer(cmd)
            else:
                self.line += c
                if len(self.line) == 60:
                    # A line wider than the terminal: IOS redraws it from a $.
                    self.say(c + "\x08" * 50 + "$" + self.line[-49:])
                else:
                    self.say(c)

    def page(self):
        rows, self.paging = self.paging[:23], self.paging[23:]
        for row in rows:
            self.say(row)
            if row.endswith("#") or row.endswith(">"):
                time.sleep(0.03)  # stopped right after a # for a moment
            self.say("\r\n")
        if self.paging:
            # In two pieces, as at 9600 baud: " --More-" is not the pager yet.
            self.say(" --More-")
            time.sleep(0.03)
            self.say("- ")
        else:
            self.paging = None
            self.say(self.prompt)

    def answer(self, cmd):
        if cmd == "show running-config":
            self.paging = CONFIG
            self.page()
            return
        if cmd == "configure terminal":
            self.say("Enter configuration commands, one per line.  End with CNTL/Z.\r\n")
            self.prompt = "R1(config)#"
        elif cmd == "end":
            self.prompt = "R1#"
        elif cmd == WIDE:
            self.say("interface GigabitEthernet0\r\n")
        elif cmd == "show tail":
            self.say("one\r\n description to core>")
            time.sleep(0.03)  # stopped right after a > for a moment
            self.say("\r\nthree\r\n")
        elif cmd:
            self.say(f"you typed: {cmd}\r\n")
        self.say(self.prompt)


def run(script):
    """Runs `script` against FakeIOS; returns what it logged, as JSON."""
    env = dict(os.environ, PYTHONPATH=HERE)
    proc = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env)
    FakeIOS(proc)
    # Not communicate(): it would close the script's input and read its
    # output itself, from under the device.
    err = []
    reader = threading.Thread(target=lambda: err.append(proc.stderr.read()), daemon=True)
    reader.start()
    proc.wait(timeout=60)
    reader.join(5)
    for pipe in (proc.stdin, proc.stdout, proc.stderr):
        try:
            pipe.close()
        except OSError:
            pass
    text = err[0].decode() if err else ""
    if proc.returncode:
        raise AssertionError(text)
    return json.loads(text.strip().splitlines()[-1])


class CommandTest(unittest.TestCase):
    def test_a_paged_config_comes_back_whole(self):
        # It stopped at the first line ending in # or >, and hung at --More--.
        got = run("from thyrion import session\nimport json\n"
                  "out = session.command('show running-config')\n"
                  "session.log(json.dumps({'out': out, 'prompt': session.prompt()}))\n")
        self.assertEqual(got["out"].split("\n"), CONFIG)
        self.assertEqual(got["prompt"], "R1#")

    def test_the_prompt_of_another_mode_ends_a_command_too(self):
        got = run("from thyrion import session\nimport json\n"
                  "session.command('show version')\n"
                  "a = session.command('configure terminal')\n"
                  "p = session.prompt()\n"
                  "b = session.command('end')\n"
                  "session.log(json.dumps({'a': a, 'p': p, 'b': b, 'q': session.prompt()}))\n")
        self.assertEqual(got["a"], "Enter configuration commands, one per line.  End with CNTL/Z.")
        self.assertEqual(got["p"], "R1(config)#")
        self.assertEqual((got["b"], got["q"]), ("", "R1#"))

    def test_a_wide_command_s_redrawn_echo_is_left_out(self):
        got = run("from thyrion import session\nimport json\n"
                  f"out = session.command({WIDE!r})\n"
                  "session.log(json.dumps({'out': out}))\n")
        self.assertEqual(got["out"], "interface GigabitEthernet0")

    def test_wait_for_prompt_waits_for_the_end_of_the_output(self):
        # It took the > of a line that paused for a moment for the prompt.
        got = run("from thyrion import session\nimport json\n"
                  "session.send('show tail')\n"
                  "seen = session.wait_for_prompt()\n"
                  "session.log(json.dumps({'seen': seen}))\n")
        self.assertTrue(got["seen"].endswith("three\r\nR1#"), got["seen"])

if __name__ == "__main__":
    unittest.main()
