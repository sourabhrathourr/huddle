import re
import sqlite3
from pathlib import Path

from support import ROOT, HuddleTest, load_module


class Clean(HuddleTest):
    def test_clean_deletes_ended_huddles_and_keeps_running_ones(self):
        self.pair()
        self.claude("post", "kept")
        self.pair("claude-2", "codex-2", cwd=self.worktree)
        self.claude("post", "deleted", thread="claude-2", cwd=self.worktree)
        self.claude("end", thread="claude-2", cwd=self.worktree)
        cleaned = self.huddle("clean")
        self.assertIn("Deleted 1 huddle. 1 running huddle kept.", cleaned.stdout)
        self.assertEqual([r["text"] for r in self.sql("SELECT text FROM messages WHERE sender != 'huddle'")], ["kept"])

    def test_clean_all_needs_confirmation_when_it_cant_ask(self):
        self.pair()
        refused = self.huddle("clean", "--all")
        self.assertEqual(refused.returncode, 1)
        self.assertIn("--yes", refused.stderr)
        self.assertEqual(len(self.sql("SELECT * FROM huddles")), 1)

    def test_clean_all_ends_a_waiting_agent(self):
        self.pair()
        waiting = self.background("wait", agent="claude", thread="claude-1")
        self.assertIn("Deleted 1 huddle.", self.huddle("clean", "--all", "--yes").stdout)
        out, _ = waiting.communicate(timeout=5)
        self.assertEqual(waiting.returncode, 4)
        self.assertIn("Huddle 1 has ended.", out)
        self.assertEqual(self.sql("SELECT count(*) FROM messages")[0][0], 0)

    def test_huddles_idle_for_30_days_are_deleted_when_a_new_one_opens(self):
        self.pair()
        self.claude("end")
        self.sql("UPDATE huddles SET last_at = last_at - 31 * 86400")
        self.claude("start", thread="claude-2")
        self.assertEqual(len(self.sql("SELECT * FROM huddles")), 1)


class Upgrades(HuddleTest):
    def old_database(self, columns):
        """A database from before schema versions, with some of the later columns."""
        home = Path(self.env["HUDDLE_HOME"])
        home.mkdir()
        conn = sqlite3.connect(home / "huddle.db")
        conn.executescript(f"""
            CREATE TABLE huddles (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, repo TEXT NOT NULL,
                topic TEXT, opener TEXT NOT NULL, opener_thread TEXT NOT NULL, opened_at REAL NOT NULL,
                joiner TEXT, joiner_thread TEXT, joined_at REAL, last_at REAL NOT NULL, ended_at REAL
                {", opener_dir TEXT, joiner_dir TEXT" if "dirs" in columns else ""});
            CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, huddle_id INTEGER NOT NULL,
                sender TEXT NOT NULL, text TEXT NOT NULL, sent_at REAL NOT NULL
                {", recipient TEXT" if "recipient" in columns else ""});
            CREATE INDEX messages_by_huddle ON messages(huddle_id, id);
            CREATE TABLE cursors (huddle_id INTEGER NOT NULL, thread TEXT NOT NULL, last_id INTEGER NOT NULL,
                PRIMARY KEY (huddle_id, thread));
            CREATE TABLE waiters (huddle_id INTEGER NOT NULL, thread TEXT NOT NULL, token TEXT NOT NULL,
                PRIMARY KEY (huddle_id, thread));
            INSERT INTO huddles (code, repo, opener, opener_thread, opened_at, last_at, ended_at)
                VALUES ('4821', '/r', 'claude', 't', 1, 1, 1);
            INSERT INTO messages (huddle_id, sender, text, sent_at) VALUES (1, 'claude', 'old message', 1);
        """)
        conn.close()

    def assert_upgraded(self):
        self.assertEqual(self.huddle("list").returncode, 0)
        self.assertEqual(self.sql("PRAGMA user_version")[0][0], len(load_module().MIGRATIONS))
        self.assertEqual(self.sql("SELECT text FROM messages")[0][0], "old message")
        self.pair()
        self.codex("post", "new message")
        self.assertIn("new message", self.claude("wait", "--timeout", "2").stdout)

    def test_the_first_database_upgrades(self):
        self.old_database(columns=())
        self.assert_upgraded()

    def test_a_database_that_already_has_every_column_upgrades(self):
        self.old_database(columns=("recipient", "dirs"))
        self.assert_upgraded()


class Doctor(HuddleTest):
    def install_skill(self, version):
        for path in (self.home / ".agents/skills/huddle", self.home / ".claude/skills/huddle"):
            path.mkdir(parents=True)
            (path / "SKILL.md").write_text(f"skill\n<!-- huddle {version} -->\n")

    def test_all_good(self):
        self.install_skill(load_module().VERSION)
        doctor = self.huddle("doctor")
        self.assertIn("✓ Codex can receive huddle messages (codex queue)", doctor.stdout)
        self.assertIn("✓ The skill is installed for Claude Code", doctor.stdout)
        self.assertNotIn("✗", doctor.stdout.replace("✗ Claude Code isn't installed", ""))

    def test_an_outdated_skill_is_reported(self):
        self.install_skill("0.0.1")
        doctor = self.huddle("doctor")
        self.assertEqual(doctor.returncode, 1)
        self.assertIn("✗ The skill for Codex is version 0.0.1", doctor.stdout)

    def test_it_says_which_thread_it_runs_in(self):
        self.assertIn("This shell is a Codex thread (codex-9).", self.codex("doctor", thread="codex-9").stdout)


class Versions(HuddleTest):
    def test_the_skill_and_the_command_share_a_version(self):
        version = load_module().VERSION
        self.assertEqual(self.huddle("--version").stdout.strip(), f"huddle {version}")
        marker = re.search(r"<!-- huddle (\S+) -->", (ROOT / "skill" / "SKILL.md").read_text())
        self.assertEqual(marker.group(1), version)

    def test_the_changelog_has_an_entry_for_this_version(self):
        self.assertIn(f"## {load_module().VERSION}", (ROOT / "CHANGELOG.md").read_text())
