"""Helpers: agents that one agent starts with `huddle spawn` and talks to with `huddle send`.
The stand-in apps (see support.py) speak the real protocols and answer "<app> <thread> turn <n>: <task>"."""

import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

from support import SCRIPT, HuddleTest, load_module


class Spawning(HuddleTest):
    def helper(self, name=None):
        rows = self.sql("SELECT * FROM members WHERE helper = 1" + (" AND name = ?" if name else "") + " ORDER BY id",
                        *([name] if name else []))
        return rows[-1] if rows else None

    def test_claude_starts_a_codex_helper_and_gets_its_reply(self):
        started = self.claude("spawn", "codex", "review PR 12")
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertIn("Started Codex in huddle 1.", started.stdout)
        self.assertRegex(started.stdout, r"Codex replied after \d+s:\n\ncodex codex-thread-\w+ turn 1: review PR 12")
        [turn] = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"]
        self.assertEqual(turn["params"]["input"][0]["text"], "From Claude, who started you:\nreview PR 12",
                         "the task arrives as a user turn, from the agent that started it")
        [thread] = [c for c in self.agent_calls("codex") if c["method"] == "thread/start"]
        self.assertEqual(thread["params"]["approvalPolicy"], "never", "a helper never stops to ask for approval")
        self.assertIn('You are "codex", a helper agent that Claude started', thread["params"]["developerInstructions"])
        helper = self.helper()
        self.assertEqual(helper["state"], "idle")
        self.assertTrue(helper["thread"].startswith("codex-thread-"))
        self.assertEqual(self.claude("wait", "--timeout", "1").returncode, 3,
                         "the reply Claude already printed isn't delivered a second time")

    def test_a_helper_keeps_its_thread_across_messages(self):
        first = self.claude("spawn", "codex", "fix the bug").stdout
        thread = re.search(r"(codex-thread-\w+)", first).group(1)
        again = self.claude("send", "codex", "now add a test")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn(f"{thread} turn 2: now add a test", again.stdout)

    def test_codex_starts_a_claude_helper(self):
        started = self.codex("spawn", "claude", "--name", "reviewer", "check textutil.py")
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertIn("Started reviewer (Claude) in huddle 1.", started.stdout)
        session = self.helper("reviewer")["thread"]
        self.assertIn(f"claude {session} turn 1: check textutil.py", started.stdout)
        [launch] = [c for c in self.agent_calls("claude") if "argv" in c]
        self.assertIn("--session-id", launch["argv"])
        self.assertIn("stream-json", launch["argv"])
        self.assertEqual(self.queued(), [], "Codex printed the reply, so nothing is queued into its thread")

    def test_a_background_reply_wakes_a_codex_thread(self):
        started = self.codex("spawn", "claude", "--bg", "look at the tests")
        self.assertIn("Its reply will reach you as a huddle message.", started.stdout)
        [queued] = self.eventually(self.queued, what="the reply to be queued")
        self.assertEqual(queued["thread"], "codex-1")
        self.assertIn("Reply from Claude, the helper you started:\nclaude ", queued["message"])
        self.assertIn("No reply is needed.", queued["message"], "a reply is never framed as something to answer")

    def test_a_background_reply_reaches_claude_through_its_wait(self):
        self.claude("spawn", "codex", "--bg", "look at the tests")
        waited = self.claude("wait", "--timeout", "15")
        self.assertEqual(waited.returncode, 0, waited.stderr)
        self.assertRegex(waited.stdout, r"\[Codex, replying to you · \d\d:\d\d\]\ncodex codex-thread-\w+ turn 1: look at the tests")

    def test_the_user_can_start_a_helper_from_a_terminal(self):
        started = self.huddle("spawn", "codex", "summarise the README")
        self.assertEqual(started.returncode, 0, started.stderr)
        self.assertIn("turn 1: summarise the README", started.stdout)
        [reply] = self.sql("SELECT * FROM messages WHERE reply_to IS NOT NULL")
        self.assertEqual(reply["recipient"], "you")

    def test_names(self):
        self.claude("spawn", "codex", "one")
        self.assertIn("Started codex-2 (Codex)", self.claude("spawn", "codex", "two").stdout)
        taken = self.claude("spawn", "claude", "--name", "codex", "three")
        self.assertEqual(taken.returncode, 1)
        self.assertIn("already has a member called codex", taken.stderr)
        self.assertEqual(self.claude("spawn", "codex", "--name", "you", "x").returncode, 1)

    def test_a_helper_knows_who_it_is(self):
        reply = self.claude("spawn", "codex", "WHO").stdout
        helper = self.helper()
        self.assertIn(f"member {helper['id']}", reply)
        listed = self.huddle("list", HUDDLE_MEMBER=str(helper["id"])).stdout
        self.assertRegex(listed, r"└ Codex  idle  ← you")

    def test_list_shows_helpers_under_the_agent_that_started_them(self):
        self.claude("spawn", "codex", "--name", "impl", "one")
        listed = self.claude("list").stdout
        self.assertRegex(listed, r"Claude  idle  ← you\n\s+└ impl \(Codex\)  idle")


class Conversations(HuddleTest):
    def test_helpers_ask_each_other(self):
        self.claude("spawn", "codex", "--name", "impl", "rewrite slugify")
        asked = self.claude("spawn", "claude", "--name", "tests", "ASK impl what did you change?")
        self.assertEqual(asked.returncode, 0, asked.stderr)
        self.assertIn("impl (Codex) replied after", asked.stdout, "tests' own `huddle send` got impl's answer")
        self.assertIn("turn 2: what did you change?", asked.stdout)
        [turn] = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"][1:]
        self.assertEqual(turn["params"]["input"][0]["text"], "From tests (Claude):\nwhat did you change?")
        self.assert_settles()

    def test_a_reply_between_tasks_goes_up_never_back(self):
        """impl asks tests in the background and finishes. When tests' answer arrives, impl takes a turn for it,
        and that turn's answer goes up to Claude, which started impl. Nothing goes back to tests."""
        self.claude("spawn", "codex", "--name", "impl", "start")
        self.claude("spawn", "claude", "--name", "tests", "start")
        sent = self.claude("send", "impl", "ASKBG tests are the fixtures fine?")
        self.assertIn("asked", sent.stdout)
        heard = sent.stdout
        if "[impl (Codex), replying to you" not in heard:
            # it comes with the send's reply when it's quick, else through a wait, which the send said to start
            self.assertIn("run `huddle wait` in the background", sent.stdout)
            up = self.claude("wait", "--timeout", "15")
            self.assertEqual(up.returncode, 0, up.stderr)
            heard = up.stdout
        self.assertIn("[impl (Codex), replying to you", heard)
        self.assertIn("Reply from tests (Claude):", [c for c in self.agent_calls("codex") if c["method"] == "turn/start"][-1]
                      ["params"]["input"][0]["text"])
        self.assert_settles()
        to_tests = self.sql("SELECT count(*) FROM messages WHERE recipient = 'tests'")[0][0]
        self.assertEqual(to_tests, 2, "tests only ever got Claude's task and impl's question")

    def assert_settles(self):
        """No exchange keeps itself going: once the work is done, no more messages appear."""
        time.sleep(1.5)
        count = self.sql("SELECT count(*) FROM messages")[0][0]
        time.sleep(1.5)
        self.assertEqual(self.sql("SELECT count(*) FROM messages")[0][0], count)
        self.assertEqual([r[0] for r in self.sql("SELECT state FROM members WHERE helper = 1")],
                         ["idle"] * len(self.sql("SELECT 1 FROM members WHERE helper = 1")))


class Lifetime(HuddleTest):
    def state(self, name="codex"):
        return self.sql("SELECT state FROM members WHERE name = ? AND helper = 1", name)[0][0]

    def test_a_rested_helper_wakes_up_in_its_own_thread(self):
        first = self.claude("spawn", "codex", "one", HUDDLE_NAP="1").stdout
        thread = re.search(r"(codex-thread-\w+)", first).group(1)
        self.eventually(lambda: self.state() == "asleep", what="the helper to rest")
        again = self.claude("send", "codex", "two")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn(f"codex {thread} turn 1: two", again.stdout, "a new process, the same thread")
        self.assertEqual([c["params"]["threadId"] for c in self.agent_calls("codex") if c["method"] == "thread/resume"], [thread])

    def test_a_rested_claude_helper_resumes_its_session(self):
        started = self.claude("spawn", "claude", "one", HUDDLE_NAP="1")
        self.assertIn("Started claude-2 (Claude)", started.stdout, "Claude is already called claude in its huddle")
        self.eventually(lambda: self.state("claude-2") == "asleep", what="the helper to rest")
        self.assertIn("turn 1: two", self.claude("send", "claude-2", "two").stdout)
        launches = [c["argv"] for c in self.agent_calls("claude") if "argv" in c]
        self.assertIn("--session-id", launches[0])
        self.assertIn("--resume", launches[1])

    def test_stop_then_a_message_starts_it_again(self):
        self.claude("spawn", "codex", "one")
        self.assertIn("Asked Codex to stop.", self.claude("stop", "codex").stdout)
        self.eventually(lambda: self.state() == "asleep", what="the helper to stop")
        self.assertIn("turn 1: two", self.claude("send", "codex", "two").stdout)

    def test_interrupting_a_helper_answers_whoever_asked(self):
        self.claude("spawn", "codex", "--bg", "SLOW 30")
        self.eventually(lambda: self.state() == "working", what="the helper to start working")
        self.assertIn("Interrupted Codex's current turn.", self.claude("interrupt", "codex").stdout)
        waited = self.claude("wait", "--timeout", "10")
        self.assertIn("(Interrupted before finishing.)", waited.stdout)
        self.assertEqual(self.state(), "idle")

    def test_a_waiting_send_can_give_up_and_still_get_the_reply_later(self):
        self.claude("spawn", "codex", "--bg", "start")
        self.claude("wait", "--timeout", "10")
        gave_up = self.claude("send", "codex", "--timeout", "0.5", "SLOW 2")
        self.assertEqual(gave_up.returncode, 3)
        self.assertIn("Codex is still working", gave_up.stderr)
        self.assertIn("slept", self.claude("wait", "--timeout", "10").stdout)

    def test_a_helper_that_crashes_tells_whoever_asked(self):
        crashed = self.claude("spawn", "codex", "CRASH")
        self.assertIn("Codex stopped unexpectedly before finishing", crashed.stdout)
        self.eventually(lambda: self.state() == "failed", what="the helper to be marked failed")
        self.assertIn("turn 1: hello again", self.claude("send", "codex", "hello again").stdout)

    def test_a_helper_that_cant_start_says_why(self):
        failed = self.claude("spawn", "codex", "anything", FAKE_CODEX_BROKEN="1")
        self.assertEqual(failed.returncode, 0, failed.stderr)
        self.assertIn("Couldn't start Codex", failed.stdout)
        self.assertIn("not logged in", failed.stdout)
        self.assertEqual(self.state(), "failed")

    def test_ending_the_huddle_stops_its_helpers(self):
        self.claude("spawn", "codex", "one")
        pid = self.sql("SELECT pid FROM members WHERE helper = 1")[0][0]
        self.assertIsNotNone(pid)
        self.claude("end")
        self.eventually(lambda: self.sql("SELECT pid FROM members WHERE helper = 1")[0][0] is None,
                        what="the runner to stop")
        self.assertEqual(self.state(), "asleep")


class WithPairing(HuddleTest):
    def test_a_paired_thread_can_start_helpers_in_the_same_huddle(self):
        self.pair()
        self.queued()
        started = self.claude("spawn", "codex", "--name", "tests", "write tests")
        self.assertIn("Started tests (Codex) in huddle 1.", started.stdout)
        self.assertEqual(self.queued(), [], "the paired Codex thread isn't bothered by a task for the helper")
        self.huddle("say", "everyone stop and summarise")
        queued = self.eventually(self.queued, what="the user's message to reach the paired Codex")
        self.assertIn("From the user:\neveryone stop and summarise", queued[0]["message"])
        reply = self.eventually(lambda: self.sql("SELECT * FROM messages WHERE sender = 'tests' AND recipient = 'you'"),
                                what="the helper to answer the user")
        self.assertIn("everyone stop and summarise", reply[0]["text"])


class Review(HuddleTest):
    """Failures Codex found reviewing 0.2.0: each one left an asker waiting or a reply undelivered."""

    def state(self):
        return self.sql("SELECT state FROM members WHERE helper = 1")[0][0]

    def test_a_turn_the_app_refuses_is_answered_and_the_helper_carries_on(self):
        refused = self.claude("spawn", "codex", "REJECT this")
        self.assertIn("(Couldn't start a turn:", refused.stdout)
        self.assertIn("turn rejected by the stand-in", refused.stdout)
        self.assertIn("turn 1: next", self.claude("send", "codex", "next").stdout)

    def test_messages_queued_behind_a_crash_are_still_answered(self):
        self.claude("spawn", "codex", "start")
        self.claude("send", "codex", "--bg", "SLOWCRASH 1")
        self.claude("send", "codex", "--bg", "queued behind it")
        got = ""
        for _ in range(2):
            got += self.claude("wait", "--timeout", "15").stdout
        self.assertIn("stopped unexpectedly", got)
        self.assertIn("turn 1: queued behind it", got, "a fresh runner took over the queued message")

    def test_a_reply_for_an_asker_that_was_killed_is_delivered(self):
        self.claude("spawn", "codex", "start")
        asker = subprocess.Popen([sys.executable, str(SCRIPT), "send", "codex", "SLOW 1"], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, cwd=self.repo, env=self.env_for("claude", "claude-1"))
        self.eventually(lambda: self.sql("SELECT count(*) FROM awaiting")[0][0], what="the send to start waiting")
        os.kill(asker.pid, signal.SIGKILL)
        asker.wait()
        waited = self.claude("wait", "--timeout", "15")
        self.assertIn("slept", waited.stdout, "the held reply is released once its asker is gone")

    def test_a_runner_pid_reused_by_another_program_doesnt_count(self):
        self.claude("spawn", "codex", "start")
        self.claude("stop", "codex")
        self.eventually(lambda: self.state() == "asleep", what="the helper to stop")
        self.sql("UPDATE members SET pid = ? WHERE helper = 1", os.getpid())  # alive, but not a runner
        again = self.claude("send", "codex", "hello")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("turn 1: hello", again.stdout)


class Steps(HuddleTest):
    """What each helper does in a turn, recorded for the watch."""

    def steps(self, member):
        return [(r["kind"], r["title"], r["detail"], r["status"]) for r in
                self.sql("SELECT * FROM steps WHERE member = ? AND kind != 'dropped' ORDER BY id", member)]

    def test_a_codex_helper_s_thinking_commands_and_edits(self):
        self.claude("spawn", "codex", "fix the retry")
        steps = self.steps("codex")
        self.assertEqual(steps[0], ("think", "thinking", "Looking at the retry.", "ok"))
        self.assertEqual(steps[1], ("say", "said", "I'll run the tests first.", "ok"))
        self.assertEqual(steps[2], ("run", "pytest -q  (exit 1)", "F.\n1 failed, 1 passed", "failed"))
        kind, title, detail, status = steps[3]
        self.assertEqual((kind, title, status), ("edit", "fetcher.py  +2 −1", "ok"))
        self.assertIn("--- /repo/fetcher.py\n@@ -1 +1 @@\n-old\n+new", detail)
        [turn] = self.sql("SELECT DISTINCT turn FROM steps")
        self.assertEqual(turn[0], self.sql("SELECT id FROM messages WHERE text = 'fix the retry'")[0][0])
        [start] = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"]
        self.assertEqual(start["params"]["summary"], "detailed", "Codex is asked to summarise its reasoning")

    def test_a_claude_helper_s_thinking_and_tool_calls(self):
        self.claude("spawn", "claude", "--name", "tests", "check the fixtures")
        steps = self.steps("tests")
        self.assertEqual(steps[0], ("think", "thinking", "The fixture looks stale.", "ok"))
        self.assertEqual(steps[1], ("say", "said", "Checking the fixtures.", "ok"))
        self.assertEqual(steps[2], ("run", "ls tests", "test_a.py\ntest_b.py", "ok"))
        kind, title, detail, status = steps[3]
        self.assertEqual((kind, title, status), ("edit", "test_a.py  +1 −1", "ok"))
        self.assertIn("-x = 1\n+x = 2", detail)
        self.assertEqual(len(steps), 4, "its final words are its reply, not a step")
        self.assertEqual(self.sql("SELECT count(*) FROM steps WHERE member = 'tests' AND kind = 'dropped'")[0][0], 1,
                         "kept as dropped, so a watch that already drew it takes it away")


class Steering(HuddleTest):
    def test_the_user_steers_a_working_codex_helper(self):
        self.claude("spawn", "codex", "--bg", "SLOW 3")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        self.huddle("say", "-c", "1", "--to", "codex", "--steer", "also check the README")
        steer = self.eventually(lambda: [c for c in self.agent_calls("codex") if c["method"] == "turn/steer"], what="a steer")
        self.assertEqual(steer[0]["params"]["input"][0]["text"], "From the user (only you can see this):\nalso check the README")
        self.claude("wait", "--timeout", "15")
        time.sleep(1)
        turns = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"]
        self.assertEqual(len(turns), 1, "the steer joined the running turn instead of starting another")
        [step] = self.sql("SELECT * FROM steps WHERE title = 'steered by you'")
        self.assertEqual(step["detail"], "also check the README")


    def test_without_steer_a_message_waits_for_the_next_turn(self):
        self.claude("spawn", "codex", "--bg", "SLOW 2")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        self.huddle("say", "-c", "1", "--to", "codex", "after that, the README")
        self.eventually(lambda: len([c for c in self.agent_calls("codex") if c["method"] == "turn/start"]) == 2,
                        what="a turn of its own", timeout=20)
        self.assertEqual([c for c in self.agent_calls("codex") if c["method"] == "turn/steer"], [])


class Show(HuddleTest):
    """Opening a member's real session in its own app."""

    def test_an_idle_codex_helper_opens_in_codex(self):
        self.claude("spawn", "codex", "--cwd", str(self.worktree), "look around")
        thread = self.sql("SELECT thread FROM members WHERE helper = 1")[0][0]
        shown = self.huddle("show", "codex", "-c", "1")
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn("Opening Codex's session in Codex, here. It's the real thread", shown.stderr)
        [opened] = [c for c in self.agent_calls("codex") if "resume" in c]
        self.assertEqual(opened["resume"], thread)
        self.assertEqual(os.path.realpath(opened["cwd"]), os.path.realpath(self.worktree), "where the helper works")

    def test_opening_a_helper_frees_its_session_and_holds_its_messages(self):
        # an idle helper's runner keeps its session loaded; the app the user opens would find it locked
        self.claude("spawn", "codex", "look around")
        runner = self.sql("SELECT pid FROM members WHERE helper = 1")[0][0]
        self.assertTrue(runner, "the runner stays, idle")
        close = Path(self.env["HUDDLE_HOME"]) / "closed"
        shown = subprocess.Popen([sys.executable, str(SCRIPT), "show", "codex", "-c", "1"], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, cwd=self.repo, env=self.env_for(FAKE_RESUME_UNTIL=str(close)))
        self.addCleanup(lambda: shown.poll() is None and shown.kill())
        self.eventually(lambda: [c for c in self.agent_calls("codex") if "resume" in c], what="Codex to open")
        pid, state, activity = self.sql("SELECT pid, state, activity FROM members WHERE helper = 1")[0]
        self.assertIsNone(pid, "the runner let go before Codex opened")
        self.assertEqual((state, activity), ("open", "open in Codex"))
        self.assertIn("open in Codex", self.huddle("list").stdout)
        # a message while it's open waits for the user to close it
        self.huddle("say", "--to", "codex", "one more thing")
        time.sleep(1)
        self.assertEqual(tuple(self.sql("SELECT state, pid FROM members WHERE helper = 1")[0]), ("open", None))
        self.assertEqual(self.huddle("show", "codex", "-c", "1").returncode, 1, "it can't be opened twice")
        close.touch()
        self.assertEqual(shown.wait(timeout=30), 0)
        # then it gets it, in its own thread
        self.eventually(lambda: self.sql("SELECT count(*) FROM messages WHERE sender = 'codex'")[0][0] == 2,
                        what="the helper to answer what waited")

    def test_an_idle_claude_helper_opens_in_claude_code(self):
        self.claude("spawn", "claude", "--name", "writer", "draft it")
        session = self.sql("SELECT thread FROM members WHERE name = 'writer'")[0][0]
        self.huddle("show", "writer", "-c", "1")
        launches = [c["argv"] for c in self.agent_calls("claude") if "argv" in c]
        self.assertEqual(launches[-1], ["--resume", session])

    def test_a_working_helper_isnt_opened_by_accident(self):
        self.claude("spawn", "codex", "--bg", "SLOW 5")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        refused = self.huddle("show", "codex", "-c", "1")
        self.assertEqual(refused.returncode, 3)
        self.assertIn("is working right now", refused.stderr)
        self.assertEqual([c for c in self.agent_calls("codex") if "resume" in c], [])

    def test_a_thread_you_opened_is_already_in_its_window(self):
        self.pair()
        refused = self.huddle("show", "codex", "-c", "1")
        self.assertEqual(refused.returncode, 5, "no way to its window here: the watch follows it instead")
        self.assertIn("in a window of its own", refused.stderr)


class SharedServer(HuddleTest):
    """Codex helpers on Codex's shared server, where the user's Codex can open them alongside huddle."""

    def test_a_codex_helper_runs_there_and_stays_while_the_user_has_it_open(self):
        self.shared_codex_server()
        done = self.claude("spawn", "codex", "look around")
        self.assertIn("Codex replied", done.stdout, done.stderr)
        self.assertTrue([c for c in self.agent_calls("codex-server") if c.get("connected")], "through the shared server")
        runner, shared = self.sql("SELECT pid, shared FROM members WHERE helper = 1")[0]
        self.assertEqual(shared, 1)
        close = Path(self.env["HUDDLE_HOME"]) / "closed"
        shown = subprocess.Popen([sys.executable, str(SCRIPT), "show", "codex", "-c", "1"], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, cwd=self.repo, env=self.env_for(FAKE_RESUME_UNTIL=str(close)))
        self.addCleanup(lambda: shown.poll() is None and shown.kill())
        self.eventually(lambda: [c for c in self.agent_calls("codex") if "resume" in c], what="Codex to open")
        # nothing let go: Claude can still talk to it while the user has it open
        self.assertEqual(tuple(self.sql("SELECT pid, state FROM members WHERE helper = 1")[0]), (runner, "idle"))
        again = self.claude("send", "codex", "one more thing")
        self.assertIn("Codex replied", again.stdout, again.stderr)
        close.touch()
        self.assertEqual(shown.wait(timeout=30), 0)
        self.assertEqual(self.sql("SELECT pid FROM members WHERE helper = 1")[0][0], runner)

    def test_a_working_helper_opens_too(self):
        self.shared_codex_server()
        self.claude("spawn", "codex", "--bg", "SLOW 5")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        close = Path(self.env["HUDDLE_HOME"]) / "closed"
        close.touch()
        shown = self.huddle("show", "codex", "-c", "1", FAKE_RESUME_UNTIL=str(close))
        self.assertEqual(shown.returncode, 0, shown.stderr)

    def test_its_commands_know_which_helper_they_are(self):
        # the shared server runs commands with its own environment: only Codex's thread id says who's asking
        self.shared_codex_server()
        self.claude("spawn", "codex", "look around")
        thread = self.sql("SELECT thread FROM members WHERE helper = 1")[0][0]
        listed = self.huddle("list", agent="codex", thread=thread)
        self.assertRegex(listed.stdout, r"Codex\s+\S+\s+← you")


class TheUsersOwnTurns(HuddleTest):
    """On the shared server, the user can talk to a helper in Codex itself; its runner sees those turns."""

    def helper(self, events):
        module = load_module()
        h = module.CodexHelper.__new__(module.CodexHelper)
        h.thread, h.turn, h.others_turn, h.final, h.last, h.thoughts = "t1", None, None, None, None, {}
        h.steps, h.events, h.p = module.Steps(), module.queue.Queue(), None
        for e in events:
            h.events.put(e)
        return h, module

    def test_a_turn_started_in_codex_is_followed_to_its_answer(self):
        h, _ = self.helper([
            {"method": "turn/started", "params": {"threadId": "t1", "turn": {"id": "u1"}}},
            {"method": "item/completed", "params": {"threadId": "t1", "turnId": "u1",
                                                     "item": {"type": "userMessage", "content": [{"type": "text", "text": "what's left?"}]}}},
            {"method": "item/completed", "params": {"threadId": "other", "turnId": "x9", "item": {"type": "agentMessage", "text": "not ours"}}},
            {"method": "item/completed", "params": {"threadId": "t1", "turnId": "u1", "item": {"type": "agentMessage", "text": "Two tests."}}},
            {"method": "turn/completed", "params": {"threadId": "t1", "turn": {"id": "u1", "status": "completed"}}},
        ])
        self.assertEqual(h.others(), ("u1", "what's left?"))
        self.assertTrue(h.busy())
        results = [h.poll() for _ in range(3)]
        self.assertEqual(results[-1], (True, "Two tests.", None))
        self.assertFalse(h.busy(), "once the user's turn is over, the helper takes huddle's next message")

    def test_another_turn_never_ends_huddles_own(self):
        h, _ = self.helper([
            {"method": "item/completed", "params": {"threadId": "t1", "turnId": "u2", "item": {"type": "agentMessage", "text": "theirs"}}},
            {"method": "turn/completed", "params": {"threadId": "t1", "turn": {"id": "u2", "status": "completed"}}},
            {"method": "turn/completed", "params": {"threadId": "t1", "turn": {"id": "mine", "status": "completed"}}},
        ])
        h.turn = "mine"
        self.assertEqual([h.poll()[0] for _ in range(3)], [False, False, True])


class Delivery(HuddleTest):
    """Fixes from the final review: replies are never lost or doubled, and runners are matched exactly."""

    def test_a_reply_released_after_the_read_mark_passed_it_still_arrives(self):
        self.claude("spawn", "codex", "look around")
        hid = self.sql("SELECT huddle_id FROM members WHERE helper = 1")[0][0]
        claude = self.sql("SELECT id FROM members WHERE name = 'claude'")[0][0]
        # Claude asked (message 1000); the reply is held for its asker, which then dies without taking it
        self.sql("INSERT INTO messages (id, huddle_id, sender, recipient, text, sent_at) VALUES (1000, ?, 'claude', 'codex', 'q', 1)", hid)
        self.sql("INSERT INTO messages (id, huddle_id, sender, recipient, text, sent_at, reply_to, held) "
                 "VALUES (1001, ?, 'codex', 'claude', 'THE HELD REPLY', 2, 1000, 1)", hid)
        self.sql("INSERT INTO awaiting (message, member, pid) VALUES (1000, ?, 999999)", claude)
        # meanwhile Claude's read mark moves past it
        self.sql("INSERT INTO messages (id, huddle_id, sender, recipient, text, sent_at) VALUES (1002, ?, 'you', 'claude', 'later', 3)", hid)
        self.sql("INSERT INTO reads VALUES (?, 1002) ON CONFLICT(member) DO UPDATE SET last_id = 1002", claude)
        self.huddle("say", "--to", "codex", "anything")  # any delivery sweeps up the dead asker's claim
        got = self.claude("wait", "--timeout", "5")
        self.assertIn("THE HELD REPLY", got.stdout)
        again = self.claude("wait", "--timeout", "1")
        self.assertNotIn("THE HELD REPLY", again.stdout, "once had, it isn't delivered again")

    def test_a_runner_is_matched_by_its_whole_member_id(self):
        module = load_module()
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "_run", "10"])
        self.addCleanup(proc.kill)
        time.sleep(0.3)
        self.assertTrue(module.process_is(proc.pid, "_run 10", at_end=True))
        self.assertFalse(module.process_is(proc.pid, "_run 1", at_end=True), "member 1's runner isn't member 10's")


class Listening(HuddleTest):
    """What reaches a Claude Code thread with no `huddle wait` of its own, and a wait that stays light."""

    def test_a_reply_brings_what_else_reached_claude_meanwhile(self):
        # the helper messages Claude mid-task; Claude, waiting on the spawn alone, hears it with the reply
        got = self.claude("spawn", "codex", "ASKBG claude which branch?")
        self.assertIn("Codex replied", got.stdout, got.stderr)
        self.assertIn("Also for you, sent while you waited:", got.stdout)
        self.assertIn("which branch?", got.stdout)
        self.assertEqual(self.claude("wait", "--timeout", "1").returncode, 3, "had once, not again through a wait")

    def test_a_reply_alone_says_nothing_more(self):
        got = self.claude("spawn", "codex", "look around")
        self.assertNotIn("Also for you", got.stdout)
        self.assertNotIn("Still working", got.stdout)

    def test_a_helper_still_at_work_with_nobody_waiting_is_pointed_out(self):
        self.claude("spawn", "codex", "--name", "slow", "--bg", "SLOW 8")
        got = self.claude("spawn", "codex", "--name", "quick", "look around")
        self.assertIn("Still working, with nobody waiting on it: slow (Codex).", got.stdout)

    def test_a_claim_left_by_a_dead_command_waits_on_nothing(self):
        self.claude("spawn", "codex", "--name", "slow", "--bg", "SLOW 8")
        [(msg, asker)] = self.sql("SELECT m.id, p.id FROM messages m JOIN members p ON p.name = 'claude' "
                                  "WHERE m.recipient = 'slow'")
        self.sql("INSERT INTO awaiting VALUES (?, ?, ?)", msg, asker, 999999)  # (no such process)
        got = self.claude("spawn", "codex", "--name", "quick", "look around")
        self.assertIn("Still working, with nobody waiting on it: slow (Codex).", got.stdout)

    def test_a_helper_someone_waits_on_isnt(self):
        slow = self.background("spawn", "codex", "--name", "slow", "SLOW 8", agent="claude", thread="claude-1")
        self.eventually(lambda: self.sql("SELECT count(*) FROM awaiting")[0][0], what="the spawn to start waiting")
        got = self.claude("spawn", "codex", "--name", "quick", "look around")
        self.assertNotIn("Still working", got.stdout, "slow's own spawn brings its reply")
        slow.kill()

    def test_a_quiet_wait_still_hears_a_message(self):
        self.claude("spawn", "codex", "look around")
        waiting = self.background("wait", agent="claude", thread="claude-1")
        time.sleep(1)
        self.huddle("say", "--to", "claude", "hello there")
        out, _ = waiting.communicate(timeout=10)
        self.assertEqual(waiting.returncode, 0, out)
        self.assertIn("hello there", out)

    def test_a_wait_ends_once_its_claude_code_window_has_closed(self):
        self.claude("spawn", "codex", "look around")
        # FAKE_CLAUDE_WINDOW puts the thread in a Claude Code process that isn't running (see support.py)
        waited = self.claude("wait", FAKE_CLAUDE_WINDOW="1")
        self.assertEqual(waited.returncode, 0, waited.stderr)
        self.assertIn("has closed", waited.stdout)
        self.assertEqual(self.sql("SELECT count(*) FROM waits")[0][0], 0, "no longer marked as listening")


class ShowBeside(HuddleTest):
    """`huddle show` from an agent: in Rex or tmux, a pane or tab beside the user; elsewhere, a pointer instead."""

    REX = {"REX_SESSION": "session:test", "REX_BLOCK": "block:claude"}

    def rex_calls(self):
        return [c["argv"] for c in self.agent_calls("rex")]

    def view_of(self, argv):
        return argv[argv.index("--") + 1:]

    def test_an_idle_helper_opens_in_a_pane_beside_claude(self):
        self.claude("spawn", "codex", "--name", "reviewer", "look around")
        shown = self.claude("show", "reviewer", **self.REX)
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn("Opened reviewer (Codex)'s session in Codex, in a pane beside this one.", shown.stdout)
        [split] = self.rex_calls()
        self.assertEqual(split[:7], ["split", "-s", "session:test", "-b", "block:claude", "--split", "right"])
        self.assertIn("--focus=false", split, "the user stays where they're typing")
        view = self.view_of(split)
        self.assertEqual(view[-5:], ["show", "reviewer", "-c", "1", "--here"])
        self.assertIn("CLAUDE_CODE_SESSION_ID", view, "the view is the user's, not Claude's")
        self.assertEqual([c for c in self.agent_calls("codex") if "resume" in c], [], "the view opens it, not this")
        # what the pane runs opens the session there
        ran = subprocess.run(view, capture_output=True, text=True, cwd=self.repo, env=self.env_for(), timeout=60)
        self.assertEqual(ran.returncode, 0, ran.stderr)
        self.assertEqual(len([c for c in self.agent_calls("codex") if "resume" in c]), 1)

    def test_a_tab_on_request_and_one_view_at_a_time(self):
        self.claude("spawn", "codex", "look around")
        self.assertIn("in a tab named", self.claude("show", "codex", "--tab", **self.REX).stdout)
        self.claude("show", "codex", **self.REX)
        tab, close, pane = self.rex_calls()
        self.assertEqual(tab[:5], ["window", "new", "-s", "session:test", "huddle"])
        self.assertEqual(close, ["window", "close", "-s", "session:test", "window:1"], "the tab it showed before goes")
        self.assertEqual(pane[0], "split")

    def test_showing_a_helper_already_in_the_view_replaces_the_view(self):
        self.claude("spawn", "codex", "--name", "reviewer", "look around")
        self.claude("show", "reviewer", **self.REX)
        view = self.view_of(self.rex_calls()[0])
        close = Path(self.env["HUDDLE_HOME"]) / "closed"
        held = subprocess.Popen(view, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=self.repo,
                                env=self.env_for(FAKE_RESUME_UNTIL=str(close), REX_BLOCK="block:1"))  # the pane
        self.addCleanup(lambda: held.poll() is None and held.kill())
        self.eventually(lambda: self.sql("SELECT shown FROM members WHERE name = 'reviewer'")[0][0], what="it to open")
        again = self.claude("show", "reviewer", "--tab", **self.REX)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(self.rex_calls()[1], ["block", "close", "-s", "session:test", "block:1"])
        close.touch()

    def test_a_helper_open_elsewhere_still_isnt_opened_twice(self):
        self.claude("spawn", "codex", "--name", "reviewer", "look around")
        close = Path(self.env["HUDDLE_HOME"]) / "closed"
        held = subprocess.Popen([sys.executable, str(SCRIPT), "show", "reviewer", "-c", "1"], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, cwd=self.repo,
                                env=self.env_for(FAKE_RESUME_UNTIL=str(close)))  # open in another terminal
        self.addCleanup(lambda: held.poll() is None and held.kill())
        self.eventually(lambda: self.sql("SELECT shown FROM members WHERE name = 'reviewer'")[0][0], what="it to open")
        refused = self.claude("show", "reviewer", **self.REX)
        self.assertIn("already open in another terminal", refused.stderr)
        close.touch()

    def test_huddle_open_makes_a_tab_the_default(self):
        self.claude("spawn", "codex", "look around")
        self.claude("show", "codex", HUDDLE_OPEN="tab", **self.REX)
        self.assertEqual(self.rex_calls()[0][:2], ["window", "new"])

    def test_a_working_helper_shows_its_work_live_in_the_watch(self):
        self.claude("spawn", "codex", "--bg", "SLOW 5")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        shown = self.claude("show", "codex", **self.REX)
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn("live in huddle watch", shown.stdout)
        self.assertEqual(self.view_of(self.rex_calls()[0])[-2:], ["watch", "1"])

    def test_without_rex_or_tmux_an_agent_is_told_where_to_run_it(self):
        self.claude("spawn", "codex", "look around")
        shown = self.claude("show", "codex")
        self.assertEqual(shown.returncode, 5)
        self.assertIn("There's no terminal here", shown.stderr)
        self.assertIn("huddle show codex -c 1", shown.stderr)
        self.assertEqual([c for c in self.agent_calls("codex") if "resume" in c], [], "nothing opened blind")


class Antigravity(HuddleTest):
    """Antigravity's CLI (`agy`) as a helper, driven through its print mode with stream-json, and as an agent that
    starts helpers of its own."""

    def launches(self):
        return [c["argv"] for c in self.agent_calls("agy") if "argv" in c]

    def turns(self):
        return [c["message"]["message"]["content"] for c in self.agent_calls("agy") if "message" in c]

    def test_claude_starts_an_antigravity_helper_and_gets_its_reply(self):
        got = self.claude("spawn", "agy", "review the retry change")
        self.assertEqual(got.returncode, 0, got.stderr)
        self.assertIn("Started Antigravity in huddle 1.", got.stdout)
        thread = self.sql("SELECT thread FROM members WHERE helper = 1")[0][0]
        self.assertTrue(thread, "its conversation, named by agy before the first message")
        self.assertRegex(got.stdout, rf"Antigravity replied after \d+s:\n\nagy {thread} turn 1: review the retry change")
        [argv] = self.launches()
        self.assertIn("--print=", argv)
        self.assertEqual(argv[argv.index("--input-format") + 1], "stream-json")
        self.assertNotIn("--mode", argv, "the Agent Mode in agy's own settings")
        self.assertNotIn("--dangerously-skip-permissions", argv, "only when the user sets it")
        self.assertEqual(argv[argv.index("--effort") + 1], "high", "high unless asked otherwise")
        self.assertNotIn("--conversation", argv)
        [first] = self.turns()
        self.assertIn('You are "agy", a helper agent', first, "a new conversation hears the helper note first")
        self.assertTrue(first.endswith("From Claude, who started you:\nreview the retry change"))

    def test_its_work_shows_as_steps(self):
        self.claude("spawn", "agy", "look around")
        steps = self.sql("SELECT kind, title, detail, status FROM steps WHERE member = 'agy' ORDER BY id")
        self.assertEqual([tuple(s[:2]) for s in steps if s[0] != "dropped"], [("run", "ls tests"), ("edit", "test_a.py")])
        self.assertEqual(steps[0][2:], ("test_a.py\ntest_b.py", "ok"))

    def test_it_keeps_one_conversation_in_one_process(self):
        self.claude("spawn", "agy", "--name", "reviewer", "first")
        again = self.claude("send", "reviewer", "second")
        self.assertRegex(again.stdout, r"turn 2: second")
        self.assertEqual(len(self.launches()), 1)
        self.assertNotIn("a helper agent", self.turns()[1], "the note comes once")

    def test_effort_and_model_as_asked(self):
        self.claude("spawn", "agy", "--effort", "xhigh", "--model", "gemini-4-neon", "think hard")
        [argv] = self.launches()
        self.assertEqual(argv[argv.index("--effort") + 1], "xhigh")
        self.assertEqual(argv[argv.index("--model") + 1], "gemini-4-neon")

    def test_the_default_effort_can_change(self):
        self.claude("spawn", "agy", "look around", HUDDLE_AGY_EFFORT="medium")
        self.assertEqual(self.launches()[0][self.launches()[0].index("--effort") + 1], "medium")

    def test_an_interrupt_ends_the_process_and_the_next_turn_continues_the_conversation(self):
        self.claude("spawn", "agy", "--name", "slow", "--bg", "SLOW 20")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        thread = self.sql("SELECT thread FROM members WHERE helper = 1")[0][0]
        self.claude("interrupt", "slow")
        waited = self.claude("wait", "--timeout", "15")
        self.assertIn("(Interrupted before finishing.)", waited.stdout)
        again = self.claude("send", "slow", "carry on")
        self.assertRegex(again.stdout, rf"agy {thread} turn 2: carry on")
        first, second = self.launches()
        self.assertEqual(second[second.index("--conversation") + 1], thread, "the same conversation, started again")

    def test_its_session_opens_in_agy(self):
        self.claude("spawn", "agy", "look around")
        thread = self.sql("SELECT thread FROM members WHERE helper = 1")[0][0]
        shown = self.huddle("show", "agy", "-c", "1")
        self.assertEqual(shown.returncode, 0, shown.stderr)
        self.assertIn([thread], [[c["resume"]] for c in self.agent_calls("agy") if "resume" in c])

    def test_antigravity_starts_a_helper_of_its_own(self):
        got = self.huddle("spawn", "codex", "check the tests", agent="agy", thread="agy-1")
        self.assertIn("Codex replied", got.stdout, got.stderr)
        [turn] = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"]
        self.assertEqual(turn["params"]["input"][0]["text"], "From Antigravity, who started you:\ncheck the tests")
        self.assertRegex(self.huddle("list", agent="agy", thread="agy-1").stdout, r"Antigravity\s+\S+\s+← you")

    def test_antigravity_cant_pair_yet(self):
        refused = self.huddle("start", agent="agy", thread="agy-1")
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("Antigravity can't connect with an open thread yet", refused.stderr)

    def test_claude_and_codex_get_the_effort_asked_for(self):
        self.claude("spawn", "claude", "--effort", "xhigh", "look around")
        argv = [c["argv"] for c in self.agent_calls("claude") if "argv" in c][0]
        self.assertEqual(argv[argv.index("--effort") + 1], "xhigh")
        self.claude("spawn", "codex", "--effort", "xhigh", "look around")
        [turn] = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"]
        self.assertEqual(turn["params"]["effort"], "xhigh")
        self.claude("spawn", "codex", "--name", "plain", "look around")
        plain = [c for c in self.agent_calls("codex") if c["method"] == "turn/start"][-1]
        self.assertNotIn("effort", plain["params"], "Codex keeps its own setting unless asked")

    def test_a_refusal_that_ended_its_turn_is_followed_up_once(self):
        # headless agy refuses what it would have asked about and ends the turn there, unanswered, calling it a
        # success; the helper asks it once to finish without that step, and the reply says what was refused
        got = self.claude("spawn", "agy", "DENY run the tests")
        self.assertEqual(got.returncode, 0, got.stderr)
        followed = self.turns()[1]
        self.assertTrue(followed.startswith("(From huddle, not the user.) Your turn ended because you were refused "
                                            "permission for `run npm test`."), followed)
        self.assertRegex(got.stdout, r"turn 2: \(From huddle, not the user\.\)")
        self.assertIn("(Antigravity was refused permission for 1 step, so it didn't happen: `run npm test`.", got.stdout,
                      "once, though agy's next result repeats it")
        self.assertEqual(len(self.turns()), 2)
        [refused] = self.sql("SELECT status, detail FROM steps WHERE member = 'agy' AND title = 'npm test'")
        self.assertEqual(refused[0], "failed")
        self.assertIn("user denied permission", refused[1], "the watch says why")
        [cancelled] = self.sql("SELECT status, detail FROM steps WHERE member = 'agy' AND title = '/repo/README.md'")
        self.assertEqual(tuple(cancelled), ("failed", "(Cancelled: the turn ended before this finished.)"),
                         "a call cancelled with the turn doesn't look like it's still running")
        self.assertTrue(self.sql("SELECT 1 FROM steps WHERE member = 'agy' AND title LIKE 'huddle asked it%'"),
                        "the watch shows huddle's follow-up")

    def test_refused_again_it_stops_there(self):
        got = self.claude("spawn", "agy", "DENYALWAYS run the tests")
        self.assertEqual(len(self.turns()), 2, "one follow-up, never a loop")
        self.assertIn("(Finished without a message.)", got.stdout)
        self.assertIn("refused permission for 1 step", got.stdout, "the same step, said once")

    def test_each_message_gets_its_own_follow_up(self):
        self.claude("spawn", "agy", "--name", "a", "DENY first")
        self.claude("send", "a", "DENY second")
        self.assertEqual(len(self.turns()), 4)

    def test_a_turn_with_nothing_refused_says_nothing_more(self):
        self.assertNotIn("refused", self.claude("spawn", "agy", "look around").stdout)

    def test_the_user_can_let_it_run_everything(self):
        self.claude("spawn", "agy", "look around", HUDDLE_AGY_SKIP_PERMISSIONS="1")
        self.assertIn("--dangerously-skip-permissions", self.launches()[0])

    def test_after_a_refusal_a_clean_message_is_just_answered(self):
        # agy's results go on listing earlier refusals; a later message that's refused nothing isn't followed up
        self.claude("spawn", "agy", "--name", "a", "DENY first")
        got = self.claude("send", "a", "look around")
        self.assertRegex(got.stdout, r"turn 3: look around\n$", "its own answer, with no refusal note")
        self.assertEqual(len(self.turns()), 3)

    def test_a_refusal_it_answered_anyway_isnt_followed_up(self):
        got = self.claude("spawn", "agy", "DENYSOFT run the tests")
        self.assertEqual(len(self.turns()), 1)
        self.assertRegex(got.stdout, r"turn 1: DENYSOFT run the tests\n\n\(Antigravity was refused permission for 1 "
                                     r"step, so it didn't happen: `run npm test`\.")

    def test_a_step_under_review_isnt_taken_for_finished(self):
        self.claude("spawn", "agy", "look around")
        [run] = self.sql("SELECT status, detail FROM steps WHERE member = 'agy' AND kind = 'run'")
        self.assertEqual(tuple(run), ("ok", "test_a.py\ntest_b.py"))

    def test_a_conversation_it_cant_continue_starts_afresh(self):
        self.claude("spawn", "agy", "--name", "slow", "--bg", "SLOW 20")
        self.eventually(lambda: self.sql("SELECT state FROM members WHERE helper = 1")[0][0] == "working", what="work")
        self.claude("interrupt", "slow")
        self.claude("wait", "--timeout", "15")
        (self.agent_log.parent / "agy-gone").touch()  # say, interrupted before agy saved it
        got = self.claude("send", "slow", "carry on")
        self.assertRegex(got.stdout, r"turn 1: carry on")
        self.assertNotIn("--conversation", self.launches()[-1])
        self.assertIn('You are "slow", a helper agent', self.turns()[-1], "a new conversation hears the note again")

    def test_a_crash_mid_step_leaves_nothing_running(self):
        got = self.claude("spawn", "agy", "CRASHMID")
        self.assertIn("Antigravity stopped unexpectedly before finishing.", got.stdout)
        [step] = self.sql("SELECT status, detail FROM steps WHERE member = 'agy' AND title = '/repo/README.md'")
        self.assertEqual(tuple(step), ("failed", "(Cancelled: the turn ended before this finished.)"))
