#!/bin/sh
# Add one platform's huddle-watch to a release that scripts/package.sh built:
# huddle-watch-TARGET.tar.gz beside huddle.tar.gz, and its line in SHA256SUMS.
#   scripts/package-watch.sh OUT_DIR TARGET BINARY
# TARGET is the Rust target triple install.sh asks for, e.g. aarch64-apple-darwin.
set -eu
out=${1:?usage: scripts/package-watch.sh OUT_DIR TARGET BINARY}
target=${2:?usage: scripts/package-watch.sh OUT_DIR TARGET BINARY}
binary=${3:?usage: scripts/package-watch.sh OUT_DIR TARGET BINARY}
[ -f "$out/SHA256SUMS" ] || { echo "Run scripts/package.sh $out first." >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$binary" "$tmp/huddle-watch"
chmod 755 "$tmp/huddle-watch"
name="huddle-watch-$target.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$out/$name" -C "$tmp" huddle-watch
cd "$out"
if command -v sha256sum >/dev/null 2>&1; then sha256sum "$name" >> SHA256SUMS; else shasum -a 256 "$name" >> SHA256SUMS; fi
echo "Added $name"
