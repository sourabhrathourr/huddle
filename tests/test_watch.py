"""The watch view. Session files here are invented, in the formats Claude Code and Codex write."""

import fcntl
import json
import os
import pty
import re
import select
import struct
import sys
import termios
import time
import unittest
from datetime import datetime, timezone

from support import ROOT, SCRIPT, HuddleTest, load_module

BINARY = ROOT / "watch" / "target" / "release" / "huddle-watch"

huddle = load_module()
ANSI = re.compile(r"\033\[[0-9;]*[A-Za-z]")


def plain(lines):
    return [ANSI.sub("", line) for line in lines]


def stamp(offset=0.0):
    return datetime.fromtimestamp(time.time() + offset, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def message(sender, text="hi", recipient=None):
    return {"sender": sender, "recipient": recipient, "text": text, "sent_at": time.time()}


class Layout(unittest.TestCase):
    def header(self, *args):
        return re.sub(r"\d\d:\d\d", "HH:MM", plain(huddle.render(message(*args), 80))[1])

    def test_each_header_says_who_and_to_whom(self):
        self.assertEqual(self.header("codex"), " ● Codex  to Claude · HH:MM")
        self.assertEqual(self.header("claude"), " ● Claude  to Codex · HH:MM")
        self.assertEqual(self.header("you"), " ● You  to both · HH:MM")
        self.assertEqual(self.header("you", "hi", "codex"), " ● You  to Codex · HH:MM")
        self.assertEqual(self.header("claude", "hi", "you"), " ● Claude  to you · HH:MM")

    def test_text_sits_under_the_name(self):
        self.assertEqual(plain(huddle.render(message("codex", "hello"), 80))[2], "   hello")

    def test_wrapping_ignores_colour_codes(self):
        text = "Skip the retry once `job.committed` is set at `runner.py:88` and keep `retry_after` for timeouts."
        self.assertEqual(plain(huddle.body(text, 40)), huddle.body(text.replace("`", ""), 40),
                         "styled text wraps exactly where the same text without styling does")

    def test_light_markdown(self):
        text = "## Findings\n\n\n- **one** [file](/a/b.py)\n```\ncode\n```"
        self.assertEqual(plain(huddle.body(text, 80)), ["Findings", "", "• one file", "  code"])


class Sessions(HuddleTest):
    """Reading what the user and each agent say to each other in the agent's own app."""

    def write(self, path, *entries):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")

    def claude_file(self):
        return self.home / ".claude" / "projects" / "-repo" / "claude-1.jsonl"

    def codex_file(self):
        return self.home / ".codex" / "sessions" / "2026" / "01" / "02" / "rollout-2026-01-02T03-04-05-codex-1.jsonl"

    def reader(self, agent, thread):
        os.environ["HOME"] = str(self.home)  # where the module looks for session files
        self.addCleanup(os.environ.__setitem__, "HOME", os.path.expanduser("~"))
        module = load_module()
        return module, module.Direct(agent, thread, time.time() - 60)

    def test_claude_prompts_and_final_replies(self):
        self.write(self.claude_file(),
                   {"type": "user", "origin": {"kind": "human"}, "timestamp": stamp(), "message": {"content": "what's up?"}},
                   {"type": "assistant", "timestamp": stamp(), "message": {"content": [{"type": "text", "text": "Checking."}]}},
                   {"type": "user", "timestamp": stamp(), "message": {"content": [{"type": "tool_result", "content": "x"}]}},
                   {"type": "assistant", "timestamp": stamp(), "message": {"content": [{"type": "text", "text": "All quiet."}]}},
                   {"type": "system", "subtype": "turn_duration", "timestamp": stamp()},
                   # a turn the huddle started: no prompt to show, but the reply to the user counts
                   {"type": "user", "origin": {"kind": "task-notification"}, "timestamp": stamp(),
                    "message": {"content": "<task-notification>done</task-notification>"}},
                   {"type": "assistant", "timestamp": stamp(), "message": {"content": [{"type": "text", "text":
                    "> **Codex:** Found one bug.\n> At line 508.\n\nShould I fix it?"}]}},
                   {"type": "system", "subtype": "turn_duration", "timestamp": stamp()})
        _, direct = self.reader("claude", "claude-1")
        said = [(m["sender"], m["recipient"], m["text"]) for m in direct.read()]
        self.assertEqual(said, [("you", "claude", "what's up?"),
                                ("claude", "you", "All quiet."),
                                ("claude", "you", "\nShould I fix it?")])

    def test_codex_prompts_and_final_answers(self):
        def turn(trigger, prompt, answer):
            return [{"type": "event_msg", "timestamp": stamp(), "payload": {"type": "task_started",
                     "turn_attribution": {"turn_trigger": trigger}}},
                    {"type": "response_item", "timestamp": stamp(), "payload": {"type": "message", "role": "user",
                     "content": [{"type": "input_text", "text": prompt}],
                     "internal_chat_message_metadata_passthrough": {"content_item_kinds": ["user.text"]}}},
                    {"type": "response_item", "timestamp": stamp(), "payload": {"type": "message", "role": "assistant",
                     "phase": "commentary", "content": [{"type": "output_text", "text": "Looking."}]}},
                    {"type": "response_item", "timestamp": stamp(), "payload": {"type": "message", "role": "assistant",
                     "phase": "final_answer", "content": [{"type": "output_text", "text": answer}]}},
                    {"type": "event_msg", "timestamp": stamp(), "payload": {"type": "task_complete"}}]
        self.write(self.codex_file(), *turn("user", "review this", "One bug."), *turn("queue", "[Huddle 1] ...", "Agreed."))
        _, direct = self.reader("codex", "codex-1")
        said = [(m["sender"], m["recipient"], m["text"]) for m in direct.read()]
        self.assertEqual(said, [("you", "codex", "review this"), ("codex", "you", "One bug."), ("codex", "you", "Agreed.")])

    def test_only_new_lines_are_read_again(self):
        self.write(self.codex_file(), {"type": "event_msg", "timestamp": stamp(), "payload": {"type": "task_started",
                   "turn_attribution": {"turn_trigger": "user"}}})
        _, direct = self.reader("codex", "codex-1")
        direct.read()
        self.assertEqual(direct.read(), [])

    def test_working_and_idle(self):
        module, _ = self.reader("claude", "claude-1")
        self.write(self.claude_file(), {"type": "user", "origin": {"kind": "human"}, "timestamp": stamp(-42),
                                        "message": {"content": "go"}})
        self.assertAlmostEqual(time.time() - module.activity("claude", "claude-1"), 42, delta=2)
        self.write(self.claude_file(), {"type": "system", "subtype": "turn_duration", "timestamp": stamp()})
        self.assertIsNone(module.activity("claude", "claude-1"))
        self.write(self.codex_file(), {"type": "event_msg", "timestamp": stamp(-5), "payload": {"type": "task_started"}})
        self.assertIsNotNone(module.activity("codex", "codex-1"))


def screen_tail(text):
    return text[-200:]


class Terminal(HuddleTest):
    """The watch in a real (pseudo) terminal: Tab picks the recipient, Enter sends."""

    def test_message_one_agent_from_the_watch(self):
        """The watch built into the command, used where huddle-watch isn't installed."""
        text = self.watch_and_message(HUDDLE_WATCH="python")
        self.assertIn("● Codex  to Claude", text)
        self.assertIn("to Codex › ", text)
        self.assertIn("● You  to Codex", text)

    @unittest.skipUnless(BINARY.is_file(), "huddle-watch isn't built (cargo build --release in watch/)")
    def test_message_one_agent_from_the_full_screen_watch(self):
        """huddle-watch, the ratatui build: the same conversation, the same keys."""
        text = self.watch_and_message(HUDDLE_WATCH_BIN=str(BINARY))
        self.assertIn("Codex  → Claude", text)
        self.assertIn(">_", text, "Codex's mark")
        self.assertIn("both › Type a message", text, "the first frame is drawn whole")
        self.assertIn("\x1b[?1049l", screen_tail(text), "the terminal is given back on quit")

    def watch_and_message(self, **env):
        self.pair()
        self.codex("post", "Ready.")
        self.queued()
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(self.repo)
            os.execve(sys.executable, [sys.executable, str(SCRIPT), "watch"], self.env_for(**env))
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
        screen = ""

        def read(seconds):
            nonlocal screen
            end = time.time() + seconds
            while time.time() < end:
                if select.select([fd], [], [], 0.05)[0]:
                    try:
                        screen += os.read(fd, 65536).decode("utf-8", "replace")
                    except OSError:
                        return

        read(1.5)
        os.write(fd, b"\t\t")  # both -> Claude -> Codex
        read(0.5)
        os.write(fd, "keep going ✓\r".encode())
        read(1.5)
        os.write(fd, b"\x03")
        read(1)
        os.waitpid(pid, 0)
        text = ANSI.sub("", screen)
        self.assertIn("Ready.", text)
        [queued] = self.eventually(self.queued, what="the message to reach Codex")
        self.assertIn("From the user (only you can see this):\nkeep going ✓", queued["message"])
        [sent] = self.sql("SELECT * FROM messages WHERE sender = 'you'")
        self.assertEqual((sent["recipient"], sent["text"]), ("codex", "keep going ✓"))
        return text
