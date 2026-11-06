"""Shared setup: every test gets its own home, huddle history, git repo (with a worktree), and stand-ins for
`codex` and `claude`. The stand-in `codex queue` records what it was asked to queue instead of waking a real
thread. As helpers, the stand-ins speak the real protocols (Codex app-server, Claude Code stream-json) and answer
each turn with "<app> <thread> turn <n>: <task>". A task can also be one of these, for testing:
    SLOW <seconds>      take that long, unless interrupted
    CRASH               exit mid-turn
    SLOWCRASH <seconds> exit mid-turn after that long
    REJECT              (Codex) refuse to start the turn
    ASK <name> <text>   run `huddle send <name> <text>` and answer with what it printed
    ASKBG <name> <text> the same with --bg, then answer "asked"
    WHO                 answer with HUDDLE_MEMBER
Every protocol message a stand-in receives is logged to FAKE_AGENT_LOG."""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import signal
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

# What both stand-ins do with a turn's task.
FAKE_TURN = textwrap.dedent("""\
    import json, os, subprocess, sys, threading, time

    def log(**entry):
        with open(os.environ["FAKE_AGENT_LOG"], "a") as f:
            f.write(json.dumps(entry) + "\\n")

    def task_of(text):
        return text.split("\\n", 1)[1] if "\\n" in text else text  # below the "From …:" line

    def work(task, interrupted):
        \"\"\"-> (answer, finished). Runs a task the way the module docstring of tests/support.py describes.\"\"\"
        words = task.split(" ", 2)
        if words[0] == "SLOW":
            end = time.time() + float(words[1])
            while time.time() < end:
                if interrupted.is_set():
                    return None, False
                time.sleep(0.05)
            return "slept", True
        if words[0] == "CRASH":
            os._exit(9)
        if words[0] == "SLOWCRASH":
            time.sleep(float(words[1]))
            os._exit(9)
        if words[0] in ("ASK", "ASKBG"):
            cmd = [sys.executable, os.environ["HUDDLE_SCRIPT"], "send", words[1], words[2]]
            if words[0] == "ASKBG":
                cmd.insert(3, "--bg")
            out = subprocess.run(cmd, capture_output=True, text=True)
            return ("asked" if words[0] == "ASKBG" else out.stdout + out.stderr), True
        if words[0] == "WHO":
            return "member " + os.environ.get("HUDDLE_MEMBER", "?"), True
        return None, True
""")

FAKE_CODEX = textwrap.dedent("""\
    #!/usr/bin/env python3
    import json, os, sys, threading, time, uuid
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fake_turn import log, task_of, work
    if sys.argv[1:3] == ["queue", "--help"]:
        print("Usage: codex queue [OPTIONS] --thread <THREAD> --message <TEXT>")
        sys.exit(0)
    if sys.argv[1:3] == ["app-server", "--help"]:
        print("[experimental] Run the app server or related tooling")
        sys.exit(0)
    if sys.argv[1:2] == ["app-server"]:
        if os.environ.get("FAKE_CODEX_BROKEN"):
            sys.stderr.write("codex: not logged in\\n")
            sys.exit(3)
        lock, state = threading.Lock(), {"thread": None, "turns": 0}
        interrupted = threading.Event()

        def out(obj):
            with lock:
                sys.stdout.write(json.dumps(obj) + "\\n")
                sys.stdout.flush()

        def turn(text, turn_id):
            out({"method": "turn/started", "params": {"turn": {"id": turn_id}}})
            out({"method": "item/reasoning/summaryTextDelta", "params": {"itemId": "r1", "delta": "Looking at "}})
            out({"method": "item/reasoning/summaryTextDelta", "params": {"itemId": "r1", "delta": "the retry."}})
            out({"method": "item/completed", "params": {"item": {"type": "reasoning", "id": "r1", "summary": ["Looking at the retry."]}}})
            out({"method": "item/completed", "params": {"item": {"type": "agentMessage", "id": "a1", "phase": "commentary", "text": "I'll run the tests first."}}})
            out({"method": "item/started", "params": {"item": {"type": "commandExecution", "id": "c1", "command": "/bin/zsh -lc 'pytest -q'"}}})
            out({"method": "item/completed", "params": {"item": {"type": "commandExecution", "id": "c1", "command": "/bin/zsh -lc 'pytest -q'",
                 "status": "completed", "exitCode": 1, "aggregatedOutput": "F.\\n1 failed, 1 passed"}}})
            out({"method": "item/started", "params": {"item": {"type": "fileChange", "id": "f1"}}})
            out({"method": "item/completed", "params": {"item": {"type": "fileChange", "id": "f1", "status": "completed",
                 "changes": [{"path": "/repo/fetcher.py", "kind": {"type": "update"}, "diff": "@@ -1 +1 @@\\n-old\\n+new\\n+more"}]}}})
            task = task_of(text)
            answer, finished = work(task, interrupted)
            if not finished:
                out({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "interrupted"}}})
                return
            answer = answer or f"codex {state['thread']} turn {state['turns']}: {task}"
            out({"method": "item/completed", "params": {"item": {"type": "agentMessage", "phase": "final_answer", "text": answer}}})
            out({"method": "turn/completed", "params": {"turn": {"id": turn_id, "status": "completed"}}})

        for line in sys.stdin:
            m = json.loads(line)
            method, params, i = m.get("method"), m.get("params") or {}, m.get("id")
            log(app="codex", method=method, params=params)
            if method == "initialize":
                out({"id": i, "result": {"userAgent": "fake"}})
            elif method == "thread/start":
                state["thread"] = "codex-thread-" + uuid.uuid4().hex[:6]
                out({"id": i, "result": {"thread": {"id": state["thread"]}}})
            elif method == "thread/resume":
                state["thread"] = params["threadId"]
                out({"id": i, "result": {"thread": {"id": state["thread"]}}})
            elif method == "turn/start" and "REJECT" in params["input"][0]["text"]:
                out({"id": i, "error": {"code": -32600, "message": "turn rejected by the stand-in"}})
            elif method == "turn/start":
                state["turns"] += 1
                interrupted.clear()
                turn_id = f"turn-{state['turns']}"
                out({"id": i, "result": {"turn": {"id": turn_id}}})
                threading.Thread(target=turn, args=(params["input"][0]["text"], turn_id), daemon=True).start()
            elif method == "turn/interrupt":
                interrupted.set()
                out({"id": i, "result": {}})
            elif method == "turn/steer":
                out({"id": i, "result": {}})
            elif i is not None:
                out({"id": i, "result": {}})
        sys.exit(0)
    if sys.argv[1:2] == ["resume"]:
        log(app="codex", resume=sys.argv[2], cwd=os.getcwd())
        until = os.environ.get("FAKE_RESUME_UNTIL")  # stay open, as the user would, until this file exists
        while until and not os.path.exists(until):
            time.sleep(0.05)
        sys.exit(0)
    if os.environ.get("FAKE_CODEX_FAIL"):
        sys.exit(1)
    args = dict(zip(sys.argv[2::2], sys.argv[3::2]))
    with open(os.environ["FAKE_CODEX_LOG"], "a") as log_file:
        log_file.write(json.dumps({"thread": args["--thread"], "message": args["--message"]}) + "\\n")
""")

FAKE_CLAUDE = textwrap.dedent("""\
    #!/usr/bin/env python3
    import json, os, sys, threading
    from pathlib import Path
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fake_turn import log, task_of, work
    if "--help" in sys.argv:
        print("--input-format <format>  Input format (only works with --print)")
        sys.exit(0)
    args = sys.argv[1:]
    session = args[args.index("--resume") + 1] if "--resume" in args else args[args.index("--session-id") + 1]
    log(app="claude", argv=args)
    lock, turns, interrupted = threading.Lock(), [0], threading.Event()
    transcript = Path(os.environ["HOME"]) / ".claude" / "projects" / "-fake" / f"{session}.jsonl"

    def out(obj):
        with lock:
            sys.stdout.write(json.dumps(obj) + "\\n")
            sys.stdout.flush()

    def turn(text):
        transcript.parent.mkdir(parents=True, exist_ok=True)
        with open(transcript, "a") as f:
            f.write(json.dumps({"type": "user", "message": {"content": text}}) + "\\n")
        out({"type": "system", "subtype": "init", "session_id": session})
        out({"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "The fixture looks stale."},
             {"type": "text", "text": "Checking the fixtures."},
             {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls tests"}}]}})
        out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "test_a.py\\ntest_b.py"}]}})
        out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t2", "name": "Edit",
             "input": {"file_path": "/repo/tests/test_a.py", "old_string": "x = 1", "new_string": "x = 2"}}]}})
        out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2", "content": "ok"}]}})
        task = task_of(text)
        answer, finished = work(task, interrupted)
        if not finished:
            out({"type": "result", "subtype": "error_during_execution", "is_error": True})
            return
        final = answer or f"claude {session} turn {turns[0]}: {task}"
        out({"type": "assistant", "message": {"content": [{"type": "text", "text": final}]}})
        out({"type": "result", "subtype": "success", "result": final})

    for line in sys.stdin:
        m = json.loads(line)
        log(app="claude", message=m)
        if m.get("type") == "user":
            turns[0] += 1
            interrupted.clear()
            threading.Thread(target=turn, args=(m["message"]["content"],), daemon=True).start()
        elif m.get("type") == "control_request":
            interrupted.set()
            out({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"]}})
""")


# Stands in for `ps`, so each test decides which Claude Code window a thread runs in: FAKE_CLAUDE_WINDOW=N puts
# the calling huddle process under a `claude` process numbered 9000+N; without it there's no Claude process at all.
FAKE_PS = textwrap.dedent("""\
    #!/usr/bin/env python3
    import os, subprocess, sys
    if "-p" in sys.argv:  # asking about one process: the real answer
        os.execv("/bin/ps", ["ps", *sys.argv[1:]])
    window = os.environ.get("FAKE_CLAUDE_WINDOW")
    if window:
        parent = subprocess.run(["/bin/ps", "-o", "ppid=", "-p", str(os.getppid())], capture_output=True,
                                text=True).stdout.strip()  # what huddle starts its walk from
        claude = 9000 + int(window)
        print(f"{parent} {claude} Tue Oct 13 10:00:00 2026 /bin/zsh -c huddle")
        print(f"{claude} 1 Tue Oct 13 09:00:00 2026 /usr/local/bin/claude --resume")
""")


# Stands in for Codex's shared server: WebSocket over a Unix socket, each connection bridged to a fake `codex app-server`.
FAKE_SERVER = textwrap.dedent("""\
    import base64, hashlib, json, os, socket, struct, subprocess, sys, threading
    path = sys.argv[1]
    server = socket.socket(socket.AF_UNIX)
    server.bind(path)
    server.listen()

    def serve(conn):
        buf = b""
        while b"\\r\\n\\r\\n" not in buf:
            buf += conn.recv(4096)
        head, buf = buf.split(b"\\r\\n\\r\\n", 1)
        key = [l.split(b":", 1)[1].strip() for l in head.split(b"\\r\\n") if l.lower().startswith(b"sec-websocket-key")][0]
        accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest()).decode()
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n"
                     f"Sec-WebSocket-Accept: {accept}\\r\\n\\r\\n".encode())
        with open(os.environ["FAKE_AGENT_LOG"], "a") as f:
            f.write(json.dumps({"app": "codex-server", "connected": True}) + "\\n")
        p = subprocess.Popen(["codex", "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)

        def out():
            for line in p.stdout:
                data = line.rstrip("\\n").encode()
                n = len(data)
                head = bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n) if n < 65536
                                        else bytes([127]) + struct.pack(">Q", n))
                conn.sendall(head + data)
        threading.Thread(target=out, daemon=True).start()

        def exact(n):
            nonlocal buf
            while len(buf) < n:
                chunk = conn.recv(65536)
                if not chunk:
                    raise EOFError
                buf += chunk
            got, buf = buf[:n], buf[n:]
            return got
        try:
            while True:
                b0, b1 = exact(2)
                n = b1 & 0x7F
                if n == 126:
                    n = struct.unpack(">H", exact(2))[0]
                elif n == 127:
                    n = struct.unpack(">Q", exact(8))[0]
                mask = exact(4)
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(exact(n)))
                if b0 & 0x0F == 8:
                    break
                p.stdin.write(data.decode() + "\\n")
                p.stdin.flush()
        except (EOFError, OSError):
            pass
        p.terminate()

    while True:
        c, _ = server.accept()
        threading.Thread(target=serve, args=(c,), daemon=True).start()
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
        (bin_dir / "fake_turn.py").write_text(FAKE_TURN)
        for name, text in (("codex", FAKE_CODEX), ("claude", FAKE_CLAUDE), ("ps", FAKE_PS)):
            (bin_dir / name).write_text(text)
            (bin_dir / name).chmod(0o755)
        self.log = self.tmp / "codex.log"
        self.log.touch()
        self.agent_log = self.tmp / "agents.log"
        self.agent_log.touch()
        self.env = {
            "HOME": str(self.home),
            "HUDDLE_HOME": str(self.tmp / "huddle"),
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE_CODEX_LOG": str(self.log),
            "FAKE_AGENT_LOG": str(self.agent_log),
            "HUDDLE_SCRIPT": str(SCRIPT),
            "GIT_CONFIG_NOSYSTEM": "1",
            "HUDDLE_CODEX_SERVER": "off",  # never the developer's real Codex server; a test can start a fake one
        }
        self.addCleanup(self.stop_runners)
        self.repo = self.tmp / "repo"
        self.worktree = self.tmp / "repo-worktree"
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
        git_env = {**os.environ, **self.env}  # the test home, so the developer's git config doesn't apply
        for args in (["init", "-q", str(self.repo)],
                     ["-C", str(self.repo), "commit", "-q", "--allow-empty", "-m", "init"],
                     ["-C", str(self.repo), "worktree", "add", "-q", str(self.worktree), "-b", "wt"]):
            subprocess.run([*git, *args], check=True, capture_output=True, env=git_env)

    def shared_codex_server(self):
        """Start a fake of Codex's shared server and have helpers use it."""
        path = Path(tempfile.mkdtemp(prefix="cx-")) / "s.sock"  # short: a Unix socket's path has a length limit
        script = self.tmp / "fake_server.py"
        script.write_text(FAKE_SERVER)
        proc = subprocess.Popen([sys.executable, str(script), str(path)], env=self.env_for())
        self.addCleanup(proc.kill)
        self.eventually(path.exists, what="the fake server")
        self.env["HUDDLE_CODEX_SERVER"] = str(path)
        return path

    def stop_runners(self):
        """Helpers' runners are detached processes; end the ones this test started."""
        db = Path(self.env["HUDDLE_HOME"]) / "huddle.db"
        if not db.exists():
            return
        conn = sqlite3.connect(db)
        try:
            pids = [r[0] for r in conn.execute("SELECT pid FROM members WHERE pid IS NOT NULL")]
        except sqlite3.OperationalError:
            pids = []
        conn.close()
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass

    def eventually(self, check, timeout=15, what="the condition"):
        """Wait for check() to return something truthy, and return it."""
        end = time.time() + timeout
        while time.time() < end:
            result = check()
            if result:
                return result
            time.sleep(0.1)
        self.fail(f"Timed out waiting for {what}.")

    def agent_calls(self, app=None):
        items = [json.loads(line) for line in self.agent_log.read_text().splitlines()]
        return [i for i in items if app is None or i["app"] == app]

    def env_for(self, agent=None, thread=None, **extra):
        # nothing of the developer's own session: not their threads, nor the herdr or tmux they run the tests in
        env = {k: v for k, v in os.environ.items() if k not in ("CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID", "HUDDLE_MEMBER",
                                                                "HC_TERMINAL_SOCKET", "HC_TERMINAL_ID", "TMUX", "TMUX_PANE")}
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
