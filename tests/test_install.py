"""install.sh, `huddle update` and `huddle uninstall`, against a release built locally with scripts/package.sh."""

import os
import platform
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from support import ROOT, load_module

VERSION = load_module().VERSION
TARGET = {("Darwin", "arm64"): "aarch64-apple-darwin", ("Darwin", "x86_64"): "x86_64-apple-darwin",
          ("Linux", "x86_64"): "x86_64-unknown-linux-gnu", ("Linux", "aarch64"): "aarch64-unknown-linux-gnu"
          }.get((platform.system(), platform.machine()))


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

    def with_watch(self):
        """Add a stand-in huddle-watch for this machine to the release, as CI adds the real builds."""
        fake = self.tmp / "huddle-watch"
        fake.write_text("#!/bin/sh\necho huddle-watch stand-in\n")
        fake.chmod(0o755)
        subprocess.run([str(ROOT / "scripts" / "package-watch.sh"), str(self.release), TARGET, str(fake)],
                       check=True, capture_output=True)
        return self.home / ".local" / "bin" / "huddle-watch"

    @unittest.skipUnless(TARGET, "no huddle-watch build for this platform")
    def test_the_full_screen_watch_is_installed_beside_the_command(self):
        watch = self.with_watch()
        installed = self.install()
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertNotIn("isn't available", installed.stdout)
        self.assertEqual(subprocess.run([str(watch)], capture_output=True, text=True).stdout.strip(), "huddle-watch stand-in")

    def test_without_a_build_for_this_machine_the_rest_still_installs(self):
        installed = self.install()
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertIn("The full-screen watch isn't available for this machine", installed.stdout)
        self.assertFalse((self.home / ".local" / "bin" / "huddle-watch").exists())

    @unittest.skipUnless(TARGET, "no huddle-watch build for this platform")
    def test_a_corrupted_watch_is_skipped(self):
        watch = self.with_watch()
        sums = self.release / "SHA256SUMS"
        sums.write_text(sums.read_text().replace(sums.read_text().splitlines()[-1].split()[0], "0" * 64))
        installed = self.install()
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.assertIn("isn't available", installed.stdout)
        self.assertFalse(watch.exists())

    @unittest.skipUnless(TARGET, "no huddle-watch build for this platform")
    def test_upgrading_without_a_watch_removes_the_old_one(self):
        # an older watch that the new version can't download a match for would still be picked up, out of step
        watch = self.with_watch()
        self.assertEqual(self.install().returncode, 0)
        self.assertTrue(watch.exists())
        sums = self.release / "SHA256SUMS"
        sums.write_text(sums.read_text().replace(sums.read_text().splitlines()[-1].split()[0], "0" * 64))
        upgraded = self.install()
        self.assertEqual(upgraded.returncode, 0, upgraded.stderr)
        self.assertIn("isn't available", upgraded.stdout)
        self.assertFalse(watch.exists(), "the old watch is gone; `huddle watch` uses its built-in view")

    def test_a_corrupted_download_installs_nothing(self):
        (self.release / "SHA256SUMS").write_text("0" * 64 + "  huddle.tar.gz\n")
        failed = self.install()
        self.assertEqual(failed.returncode, 1)
        self.assertIn("doesn't match its checksum", failed.stderr)
        self.assertFalse(self.bin.exists())

    def test_uninstall_removes_the_command_and_skill_and_keeps_history(self):
        watch = self.with_watch() if TARGET else None
        self.install()
        history = self.home / ".huddle"
        history.mkdir()
        removed = subprocess.run([str(self.bin), "uninstall"], capture_output=True, text=True, env=self.env,
                                 stdin=subprocess.DEVNULL)
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertFalse(self.bin.exists())
        self.assertFalse(watch and watch.exists())
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
