"""install.sh, `huddle update` and `huddle uninstall`, against a release built locally with scripts/package.sh."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from support import ROOT, load_module

VERSION = load_module().VERSION


class Install(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="huddle-install-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.release = self.tmp / "release"
        subprocess.run([str(ROOT / "scripts" / "package.sh"), str(self.release)], check=True, capture_output=True)
        self.env = {"HOME": str(self.home), "PATH": "/usr/bin:/bin", "HUDDLE_DOWNLOAD_URL": f"file://{self.release}"}
        self.bin = self.home / ".local" / "bin" / "huddle"

    def install(self):
        return subprocess.run(["sh", str(ROOT / "install.sh")], capture_output=True, text=True, env=self.env)

    def test_install_puts_the_command_and_the_skill_in_place(self):
        installed = self.install()
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertIn(f"Installed huddle {VERSION}.", installed.stdout)
        self.assertIn("isn't on your PATH yet", installed.stdout)
        self.assertTrue(os.access(self.bin, os.X_OK))
        skill = self.home / ".agents" / "skills" / "huddle" / "SKILL.md"
        self.assertEqual(skill.read_text(), (ROOT / "skill" / "SKILL.md").read_text())
        claude = self.home / ".claude" / "skills" / "huddle"
        self.assertTrue(claude.is_symlink())
        self.assertEqual((claude / "SKILL.md").read_text(), skill.read_text())

    def test_reinstalling_upgrades_and_keeps_history(self):
        self.install()
        history = self.home / ".huddle" / "huddle.db"
        history.parent.mkdir()
        history.write_text("history")
        self.bin.write_text("old")
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(subprocess.run([str(self.bin), "--version"], capture_output=True, text=True,
                                        env=self.env).stdout.strip(), f"huddle {VERSION}")
        self.assertEqual(history.read_text(), "history")

    def test_a_corrupted_download_installs_nothing(self):
        (self.release / "SHA256SUMS").write_text("0" * 64 + "  huddle.tar.gz\n")
        failed = self.install()
        self.assertEqual(failed.returncode, 1)
        self.assertIn("doesn't match its checksum", failed.stderr)
        self.assertFalse(self.bin.exists())

    def test_uninstall_removes_the_command_and_skill_and_keeps_history(self):
        self.install()
        history = self.home / ".huddle"
        history.mkdir()
        removed = subprocess.run([str(self.bin), "uninstall"], capture_output=True, text=True, env=self.env,
                                 stdin=subprocess.DEVNULL)
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertFalse(self.bin.exists())
        self.assertFalse((self.home / ".agents" / "skills" / "huddle").exists())
        self.assertFalse((self.home / ".claude" / "skills" / "huddle").is_symlink())
        self.assertTrue(history.exists())
        self.assertIn("Your history is still in", removed.stdout)

    def test_a_development_install_refuses_to_update_itself(self):
        refused = subprocess.run([str(ROOT / "huddle"), "update"], capture_output=True, text=True, env=self.env)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("development install", refused.stderr)


if __name__ == "__main__":
    unittest.main()
