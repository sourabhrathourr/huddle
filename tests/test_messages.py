from support import HuddleTest


class Delivery(HuddleTest):
    def setUp(self):
        super().setUp()
        self.pair()
        self.queued()

    def test_codex_is_woken_with_a_message_from_a_colleague(self):
        self.claude("post", "Is the retry safe?")
        [queued] = self.queued()
        self.assertEqual(queued["thread"], "codex-1")
        self.assertTrue(queued["message"].startswith("[Huddle 1]\n"))
        self.assertIn("From Claude (a colleague, not the user):\nIs the retry safe?", queued["message"])
        self.assertIn("If this needs a reply", queued["message"])

    def test_claude_gets_codex_messages_through_wait(self):
        self.codex("post", stdin="It is.\nSee line 40.")
        waited = self.claude("wait", "--timeout", "2")
        self.assertEqual(waited.returncode, 0)
        self.assertRegex(waited.stdout, r"\[Codex · \d\d:\d\d\]\nIt is.\nSee line 40.")

    def test_the_user_reaches_both_agents(self):
        self.huddle("say", "focus on the copy")
        self.assertIn("From the user:\nfocus on the copy", self.queued()[0]["message"])
        self.assertIn("[the user · ", self.claude("wait", "--timeout", "2").stdout)

    def test_a_message_to_codex_only(self):
        self.huddle("say", "--to", "codex", "only you")
        self.assertIn("From the user (only you can see this):\nonly you", self.queued()[0]["message"])
        self.assertEqual(self.claude("wait", "--timeout", "1").returncode, 3, "Claude never sees it")

    def test_a_message_to_claude_only(self):
        self.huddle("say", "--to", "claude", "only you")
        self.assertEqual(self.queued(), [])
        self.assertIn("[the user, to you only · ", self.claude("wait", "--timeout", "2").stdout)

    def test_an_unreachable_codex_gets_the_message_later(self):
        failed = self.claude("post", "first", FAKE_CODEX_FAIL="1")
        self.assertIn("Couldn't reach Codex's thread", failed.stderr)
        self.claude("post", "second")
        [queued] = self.queued()
        self.assertIn("first", queued["message"])
        self.assertIn("second", queued["message"])

    def test_posting_does_not_skip_unread_messages(self):
        self.codex("post", "careful with line 88")
        self.claude("post", "starting on the worker")
        waited = self.claude("wait", "--timeout", "2")
        self.assertEqual(waited.returncode, 0)
        self.assertIn("careful with line 88", waited.stdout)
        self.assertNotIn("starting on the worker", waited.stdout, "a thread's own messages never come back")

    def test_codex_is_told_when_the_huddle_ends(self):
        self.huddle("end")
        [told] = self.queued()
        self.assertEqual(told["thread"], "codex-1")
        self.assertIn("The user ended the huddle", told["message"])
        self.assertIn("No reply needed", told["message"])

    def test_codex_isnt_told_about_its_own_ending(self):
        self.codex("end")
        self.assertEqual(self.queued(), [])

    def test_a_newer_wait_takes_over_without_losing_messages(self):
        first = self.background("wait", agent="claude", thread="claude-1")
        second = self.background("wait", agent="claude", thread="claude-1")
        self.codex("post", "hello")
        out, _ = first.communicate(timeout=5)
        self.assertIn("A newer wait took over", out)
        out, _ = second.communicate(timeout=5)
        self.assertIn("hello", out)

    def test_unread_messages_arrive_before_the_end(self):
        self.codex("post", "last words")
        self.codex("end")
        waited = self.claude("wait", "--timeout", "2")
        self.assertEqual(waited.returncode, 4)
        self.assertIn("last words", waited.stdout)
        self.assertIn("Huddle 1 has ended.", waited.stdout)

    def test_a_huddle_quiet_for_a_day_has_ended(self):
        self.sql("UPDATE huddles SET last_at = last_at - 86460")
        self.assertEqual(self.claude("post", "hi").returncode, 4)
