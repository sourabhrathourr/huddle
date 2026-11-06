#!/bin/sh
# Install huddle: https://github.com/sourabhrathourr/huddle
#
#   curl -fsSL https://raw.githubusercontent.com/sourabhrathourr/huddle/main/install.sh | sh
#
# Installs the `huddle` command, the skill Claude Code and Codex load, and huddle-watch (the full-screen watch)
# where a build exists for this machine.
# Re-run it to upgrade. Your huddle history in ~/.huddle is never touched.
set -eu

DOWNLOAD_URL="${HUDDLE_DOWNLOAD_URL:-https://github.com/sourabhrathourr/huddle/releases/latest/download}"
BIN_DIR="${HUDDLE_BIN_DIR:-$HOME/.local/bin}"
SKILL_DIR="$HOME/.agents/skills/huddle"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

say() { printf '%s\n' "$@"; }
die() { printf 'huddle: %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "Python 3.9 or newer is needed, and python3 isn't installed."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' ||
  die "Python 3.9 or newer is needed. This machine has $(python3 --version 2>&1)."
command -v git >/dev/null 2>&1 || die "git is needed, and it isn't installed."
command -v curl >/dev/null 2>&1 || die "curl is needed, and it isn't installed."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$DOWNLOAD_URL/huddle.tar.gz" -o "$tmp/huddle.tar.gz" || die "Couldn't download $DOWNLOAD_URL/huddle.tar.gz"
curl -fsSL "$DOWNLOAD_URL/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "Couldn't download $DOWNLOAD_URL/SHA256SUMS"
expected=$(awk '$2 == "huddle.tar.gz" { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/huddle.tar.gz" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$tmp/huddle.tar.gz" | awk '{ print $1 }')
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || die "The download doesn't match its checksum. Nothing was installed."
tar -xzf "$tmp/huddle.tar.gz" -C "$tmp"

mkdir -p "$BIN_DIR" "$(dirname "$SKILL_DIR")" "$CLAUDE_DIR/skills"
install -m 755 "$tmp/huddle" "$BIN_DIR/huddle"
rm -rf "$SKILL_DIR"
cp -R "$tmp/skill" "$SKILL_DIR"
# Claude Code reads the same skill through a link.
[ -L "$CLAUDE_DIR/skills/huddle" ] || rm -rf "$CLAUDE_DIR/skills/huddle"
ln -sfn "$SKILL_DIR" "$CLAUDE_DIR/skills/huddle"

# The full-screen watch, built for this machine. Without it, `huddle watch` uses its built-in view.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
  Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-gnu ;;
  *) target= ;;
esac
watch="huddle-watch-$target.tar.gz"
expected=$(awk -v f="$watch" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
watched=
if [ -n "$target" ] && [ -n "$expected" ] && curl -fsSL "$DOWNLOAD_URL/$watch" -o "$tmp/$watch" 2>/dev/null; then
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/$watch" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$tmp/$watch" | awk '{ print $1 }')
  fi
  if [ "$expected" = "$actual" ] && mkdir -p "$tmp/watch" && tar -xzf "$tmp/$watch" -C "$tmp/watch"; then
    install -m 755 "$tmp/watch/huddle-watch" "$BIN_DIR/huddle-watch" && watched=1
  fi
fi

# no watch for this version: an older one left behind wouldn't match the command, so it goes
[ -n "$watched" ] || rm -f "$BIN_DIR/huddle-watch"

say "Installed $("$BIN_DIR/huddle" --version)."
[ -n "$watched" ] || say "The full-screen watch isn't available for this machine; \`huddle watch\` uses its built-in view."
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "" "$BIN_DIR isn't on your PATH yet. Add this line to your shell profile (~/.zshrc or ~/.bashrc):" \
       "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
command -v claude >/dev/null 2>&1 || say "" "Claude Code isn't installed. huddle connects Claude Code with Codex."
command -v codex >/dev/null 2>&1 || say "" "Codex isn't installed. huddle connects Claude Code with Codex."
say "" "Next: ask Claude or Codex to bring in the other (\"get Codex to review this\"), or type /huddle in" \
  "Claude Code and \$huddle in Codex to connect two open threads. Run 'huddle doctor' to check your setup."
