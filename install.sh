#!/bin/sh
# Install huddle: https://github.com/sourabhrathourr/huddle
#
#   curl -fsSL https://raw.githubusercontent.com/sourabhrathourr/huddle/main/install.sh | sh
#
# Installs the `huddle` command and the skill Claude Code and Codex load.
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

say "Installed $("$BIN_DIR/huddle" --version)."
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "" "$BIN_DIR isn't on your PATH yet. Add this line to your shell profile (~/.zshrc or ~/.bashrc):" \
       "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
command -v claude >/dev/null 2>&1 || say "" "Claude Code isn't installed. huddle connects Claude Code with Codex."
command -v codex >/dev/null 2>&1 || say "" "Codex isn't installed. huddle connects Claude Code with Codex."
say "" "Next: type /huddle in Claude Code and \$huddle in Codex, in either order." \
  "Run 'huddle doctor' to check your setup."
