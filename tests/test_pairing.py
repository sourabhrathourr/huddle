import json

from support import HuddleTest


class Pairing(HuddleTest):
    def test_either_app_can_start_first(self):
        opened = self.codex("start")
        self.assertIn("Huddle 1 is open.", opened.stdout)
        self.assertIn("type /huddle in Claude Code", opened.stdout)
        self.assertIn("Joined huddle 1 with Codex.", self.claude("start").stdout)

    def test_a_brief_reaches_the_other_agent(self):
        self.codex("start")
        self.claude("start", stdin="Please review PR 7.")
        [queued] = self.queued()
        self.assertEqual(queued["thread"], "codex-1")
        self.assertIn("From Claude (a colleague, not the user):\nPlease review PR 7.", queued["message"])

    def test_the_brief_is_shown_to_the_agent_that_joins(self):
        self.claude("start", stdin="Please review PR 7.")
        joined = self.codex("start")
        self.assertIn("Claude's brief:", joined.stdout)
        self.assertIn("Please review PR 7.", joined.stdout)

    def test_starting_again_in_a_connected_thread_only_reports(self):
        self.pair()
        self.assertEqual(self.claude("start").stdout.strip(), "This thread is already in huddle 1 with Codex.")
        self.assertEqual(self.codex("start").stdout.strip(), "This thread is already in huddle 1 with Claude.")

    def test_two_threads_of_the_same_app_never_pair(self):
        self.claude("start", thread="claude-a")
        self.assertIn("Huddle 2 is open", self.claude("start", thread="claude-b").stdout)
        self.assertIn("Joined huddle 2 with Claude.", self.codex("start", "2").stdout)

    def test_after_clear_an_unjoined_huddle_is_replaced(self):
        self.claude("start", thread="claude-old", FAKE_CLAUDE_WINDOW="1")
        self.assertIn("Huddle 1 is open", self.claude("start", thread="claude-new", FAKE_CLAUDE_WINDOW="1").stdout)
        rows = self.sql("SELECT ended_at FROM huddles ORDER BY id")
        self.assertIsNotNone(rows[0]["ended_at"], "the invite /clear left behind is withdrawn")
        self.assertIsNone(rows[1]["ended_at"])
        self.assertIn("Joined huddle 1 with Claude.", self.codex("start").stdout)

    def test_when_several_threads_are_waiting_the_user_picks_one(self):
        self.codex("start", thread="codex-a")
        self.codex("start", thread="codex-b")
        asked = self.claude("start")
        self.assertEqual(asked.returncode, 2)
        self.assertIn("2 Codex threads are waiting to connect", asked.stderr)
        self.assertIn("Joined huddle 2 with Codex.", self.claude("start", "2").stdout)

    def test_the_join_names_the_other_thread(self):
        transcript = self.home / ".claude" / "projects" / "-repo" / "claude-1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("\n".join(json.dumps(o) for o in (
            {"type": "user", "origin": {"kind": "human"}, "message": {"content": "why do retries double?"}},
            {"type": "ai-title", "aiTitle": "Old title"},
            {"type": "ai-title", "aiTitle": "Retry handling in the worker"})) + "\n")
        self.claude("start")
        self.assertIn("Joined huddle 1 with Claude (thread “Retry handling in the worker”).", self.codex("start").stdout)

    def test_joining_a_same_app_invite_by_number_is_refused(self):
        self.claude("open", thread="claude-a")
        refused = self.claude("join", "1", thread="claude-b")
        self.assertEqual(refused.returncode, 1)
        self.assertIn("A huddle connects Claude Code with Codex", refused.stderr)

    def test_numbers_are_the_lowest_not_in_use(self):
        self.pair()
        self.pair("claude-2", "codex-2", cwd=self.worktree)
        self.assertEqual([r["code"] for r in self.sql("SELECT code FROM huddles ORDER BY id")], ["1", "2"])
        self.claude("end")
        self.assertIn("Huddle 1 is open.", self.claude("start", thread="claude-3").stdout)

    def test_an_invite_stays_open_for_15_minutes(self):
        self.claude("start")
        self.sql("UPDATE huddles SET opened_at = opened_at - 840")
        self.assertIn("Joined huddle 1", self.codex("start").stdout)

    def test_an_invite_older_than_15_minutes_has_expired(self):
        self.claude("start")
        self.sql("UPDATE huddles SET opened_at = opened_at - 960")
        self.assertIn("is open", self.codex("start").stdout)


class NewThreads(HuddleTest):
    """A new thread continues a running huddle only when the user names it, or after /clear in the same window.
    Any other thread holding a seat may still be in use, so a new thread never takes its place on a guess."""

    def test_a_fresh_thread_never_takes_over_a_running_huddle(self):
        self.pair(claude="claude-1")
        self.queued()
        opened = self.claude("start", thread="claude-2", stdin="Unrelated work: the release script.")
        self.assertIn("Huddle 2 is open", opened.stdout)
        self.assertEqual(self.queued(), [], "the other pair's Codex thread hears nothing")
        self.assertEqual(self.sql("SELECT opener_thread FROM huddles WHERE code = '1'")[0][0], "claude-1")

    def test_a_fresh_codex_thread_never_takes_over_a_running_huddle(self):
        self.pair()
        self.assertIn("Huddle 2 is open", self.codex("start", thread="codex-2").stdout)
        self.assertEqual(self.sql("SELECT joiner_thread FROM huddles WHERE code = '1'")[0][0], "codex-1")

    def test_after_clear_the_new_thread_continues(self):
        self.assertIn("is open", self.claude("start", FAKE_CLAUDE_WINDOW="1").stdout)
        self.codex("start")
        self.codex("post", "backend looks fine")
        continued = self.claude("start", thread="claude-2", FAKE_CLAUDE_WINDOW="1")
        self.assertIn("Continued huddle 1 with Codex, in place of an earlier Claude thread.", continued.stdout)
        self.assertIn("backend looks fine", continued.stdout, "recent messages give the new thread context")
        self.codex("post", "for the new thread")
        self.assertIn("for the new thread", self.claude("wait", "--timeout", "2", thread="claude-2").stdout)
        self.assertIn("This thread is already in huddle 1 with Claude.", self.codex("start").stdout)

    def test_a_thread_in_another_window_is_left_alone(self):
        self.claude("start", FAKE_CLAUDE_WINDOW="1")
        self.codex("start")
        self.assertIn("Huddle 2 is open", self.claude("start", thread="claude-2", FAKE_CLAUDE_WINDOW="2").stdout)

    def test_continuing_by_number(self):
        self.pair()
        continued = self.codex("start", "1", thread="codex-2")
        self.assertIn("Continued huddle 1 with Claude", continued.stdout)
        self.assertIn("type /huddle 1 in that Claude Code thread", continued.stdout)
        self.queued()
        self.claude("post", "hello")
        self.assertEqual([q["thread"] for q in self.queued()], ["codex-2"])

    def test_a_new_thread_only_sees_recent_messages_meant_for_it(self):
        self.pair()
        self.huddle("say", "--to", "codex", "only for codex")
        self.huddle("say", "--to", "claude", "only for claude")
        self.codex("post", "for both")
        continued = self.claude("start", "1", thread="claude-2")
        self.assertNotIn("only for codex", continued.stdout)
        self.assertIn("only for claude", continued.stdout)
        self.assertIn("for both", continued.stdout)

    def test_the_replaced_threads_wait_leaves_quietly(self):
        self.pair()
        old_wait = self.background("wait", agent="claude", thread="claude-1")
        self.claude("start", "1", thread="claude-2")
        out, _ = old_wait.communicate(timeout=5)
        self.assertEqual(old_wait.returncode, 0)
        self.assertIn("A newer Claude thread took this thread's place in huddle 1", out)

    def test_a_connected_thread_stays_until_asked_for_a_new_huddle(self):
        self.pair()
        self.codex("start", thread="codex-2")
        self.assertIn("This thread is already in huddle 1 with Codex.", self.claude("start").stdout)
        self.queued()
        moved = self.claude("start", "--new")
        self.assertIn("Left huddle 1.", moved.stdout)
        self.assertIn("Joined huddle 2 with Codex.", moved.stdout)
        [told] = self.queued()
        self.assertEqual(told["thread"], "codex-1")
        self.assertIn("Claude ended the huddle", told["message"])

    def test_a_missing_number_is_reported(self):
        missing = self.claude("start", "7")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("No running huddle 7.", missing.stderr)
