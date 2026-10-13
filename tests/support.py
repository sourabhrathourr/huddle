"""Shared setup: every test gets its own home, huddle history, git repo (with a worktree),
and a stand-in `codex` that records what it was asked to queue instead of waking a real thread."""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "huddle"

FAKE_CODEX = textwrap.dedent("""\
    #!/usr/bin/env python3
    import json, os, sys
    if sys.argv[1:3] == ["queue", "--help"]:
        print("Usage: codex queue [OPTIONS] --thread <THREAD> --message <TEXT>")
        sys.exit(0)
    if os.environ.get("FAKE_CODEX_FAIL"):
        sys.exit(1)
    args = dict(zip(sys.argv[2::2], sys.argv[3::2]))
    with open(os.environ["FAKE_CODEX_LOG"], "a") as log:
        log.write(json.dumps({"thread": args["--thread"], "message": args["--message"]}) + "\\n")
""")


def load_module():
    """The huddle command as a module, for testing its parts directly."""
    loader = importlib.machinery.SourceFileLoader("huddle_cli", str(SCRIPT))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader("huddle_cli", loader))
    loader.exec_module(module)
    return module


class HuddleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="huddle-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        (bin_dir / "codex").write_text(FAKE_CODEX)
        (bin_dir / "codex").chmod(0o755)
        self.log = self.tmp / "codex.log"
        self.log.touch()
        self.env = {
            "HOME": str(self.home),
            "HUDDLE_HOME": str(self.tmp / "huddle"),
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_CODEX_LOG": str(self.log),
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        self.repo = self.tmp / "repo"
        self.worktree = self.tmp / "repo-worktree"
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
        git_env = {**os.environ, **self.env}  # the test home, so the developer's git config doesn't apply
        for args in (["init", "-q", str(self.repo)],
                     ["-C", str(self.repo), "commit", "-q", "--allow-empty", "-m", "init"],
                     ["-C", str(self.repo), "worktree", "add", "-q", str(self.worktree), "-b", "wt"]):
            subprocess.run([*git, *args], check=True, capture_output=True, env=git_env)

    def env_for(self, agent=None, thread=None, **extra):
        env = {k: v for k, v in os.environ.items() if k not in ("CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID")}
        env.update(self.env)
        if agent == "claude":
            env["CLAUDE_CODE_SESSION_ID"] = thread
        elif agent == "codex":
            env["CODEX_THREAD_ID"] = thread
        env.update(extra)
        return env

    def huddle(self, *args, agent=None, thread=None, stdin="", cwd=None, **extra):
        """Run the command as a thread of `agent` (or as the user, by default)."""
        return subprocess.run([sys.executable, str(SCRIPT), *args], input=stdin, capture_output=True, text=True,
                              cwd=cwd or self.repo, env=self.env_for(agent, thread, **extra), timeout=60)

    def claude(self, *args, thread="claude-1", **kw):
        return self.huddle(*args, agent="claude", thread=thread, **kw)

    def codex(self, *args, thread="codex-1", **kw):
        return self.huddle(*args, agent="codex", thread=thread, **kw)

    def background(self, *args, agent, thread, cwd=None):
        """Start a command (such as `wait`) without waiting for it."""
        proc = subprocess.Popen([sys.executable, str(SCRIPT), *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, cwd=cwd or self.repo, env=self.env_for(agent, thread))
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        time.sleep(0.6)
        return proc

    def pair(self, claude="claude-1", codex="codex-1", cwd=None):
        self.assertIn("is open", self.claude("start", thread=claude, cwd=cwd).stdout)
        self.assertIn("Joined huddle", self.codex("start", thread=codex, cwd=cwd).stdout)

    def queued(self):
        """What was queued into Codex threads since the last call."""
        items = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.log.write_text("")
        return items

    def db(self):
        conn = sqlite3.connect(Path(self.env["HUDDLE_HOME"]) / "huddle.db")
        conn.row_factory = sqlite3.Row
        self.addCleanup(conn.close)
        return conn

    def sql(self, statement, *params):
        conn = self.db()
        rows = conn.execute(statement, params).fetchall()
        conn.commit()
        return rows
