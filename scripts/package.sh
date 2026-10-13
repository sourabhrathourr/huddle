#!/bin/sh
# Build the release files install.sh downloads: huddle.tar.gz (the command and the skill) and SHA256SUMS.
#   scripts/package.sh OUT_DIR
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?usage: scripts/package.sh OUT_DIR}
mkdir -p "$out"
out=$(cd "$out" && pwd)

version=$(python3 "$root/huddle" --version | awk '{ print $2 }')
grep -q "<!-- huddle $version -->" "$root/skill/SKILL.md" ||
  { echo "skill/SKILL.md isn't marked as version $version" >&2; exit 1; }

COPYFILE_DISABLE=1 tar -czf "$out/huddle.tar.gz" -C "$root" huddle skill
cd "$out"
if command -v sha256sum >/dev/null 2>&1; then sha256sum huddle.tar.gz > SHA256SUMS; else shasum -a 256 huddle.tar.gz > SHA256SUMS; fi
echo "Packaged huddle $version in $out"
