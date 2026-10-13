import time

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
        self.claude("start", thread="claude-old")
        self.assertIn("is open", self.claude("start", thread="claude-new").stdout)
        rows = self.sql("SELECT opener_thread, ended_at FROM huddles ORDER BY id")
        self.assertIsNotNone(rows[0]["ended_at"], "the older invite is replaced")
        self.assertIsNone(rows[1]["ended_at"])
        self.assertIn("Joined huddle 1 with Claude.", self.codex("start").stdout)

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

    def test_an_invite_stays_open_for_an_hour(self):
        self.claude("start")
        self.sql("UPDATE huddles SET opened_at = opened_at - 3540")
        self.assertIn("Joined huddle 1", self.codex("start").stdout)

    def test_an_invite_older_than_an_hour_has_expired(self):
        self.claude("start")
        self.sql("UPDATE huddles SET opened_at = opened_at - 3660")
        self.assertIn("is open", self.codex("start").stdout)


class NewThreads(HuddleTest):
    """After /clear, a closed window or a new chat, a new thread takes over from the old one."""

    def test_a_new_claude_thread_takes_the_old_ones_seat(self):
        self.pair()
        self.codex("post", "backend looks fine")
        rejoined = self.claude("start", thread="claude-2", cwd=self.repo / ".")
        self.assertIn("Rejoined huddle 1 with Codex, in place of an earlier Claude thread.", rejoined.stdout)
        self.assertIn("backend looks fine", rejoined.stdout, "recent messages give the new thread context")
        self.codex("post", "for the new thread")
        self.assertIn("for the new thread", self.claude("wait", "--timeout", "2", thread="claude-2").stdout)
        self.assertIn("This thread is already in huddle 1 with Claude.", self.codex("start").stdout)

    def test_a_new_thread_only_sees_recent_messages_meant_for_it(self):
        self.pair()
        self.huddle("say", "--to", "codex", "only for codex")
        self.huddle("say", "--to", "claude", "only for claude")
        self.codex("post", "for both")
        rejoined = self.claude("start", thread="claude-2")
        self.assertNotIn("only for codex", rejoined.stdout)
        self.assertIn("only for claude", rejoined.stdout)
        self.assertIn("for both", rejoined.stdout)

    def test_a_new_codex_thread_takes_the_old_ones_seat(self):
        self.pair()
        self.assertIn("Rejoined huddle 1 with Claude", self.codex("start", thread="codex-2").stdout)
        self.queued()
        self.claude("post", "hello")
        self.assertEqual([q["thread"] for q in self.queued()], ["codex-2"])

    def test_the_replaced_threads_wait_leaves_quietly(self):
        self.pair()
        old_wait = self.background("wait", agent="claude", thread="claude-1")
        self.claude("start", thread="claude-2")
        out, _ = old_wait.communicate(timeout=5)
        self.assertEqual(old_wait.returncode, 0)
        self.assertIn("A newer Claude thread took this thread's place in huddle 1", out)

    def test_a_pair_in_another_worktree_is_left_alone(self):
        self.pair()
        self.assertIn("is open", self.claude("start", thread="claude-wt", cwd=self.worktree).stdout)
        self.assertEqual(self.sql("SELECT opener_thread FROM huddles WHERE code = '1'")[0][0], "claude-1")

    def test_a_connected_thread_moves_to_a_newer_invite_from_the_other_app(self):
        self.pair()
        time.sleep(0.05)
        self.codex("start", thread="codex-wt", cwd=self.worktree)
        moved = self.claude("start")
        self.assertIn("Left huddle 1: a newer one is waiting.", moved.stdout)
        self.assertIn("Joined huddle 2 with Codex.", moved.stdout)
