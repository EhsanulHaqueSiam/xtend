#!/bin/sh
# Installs the xtend CLI from a GitHub release of EhsanulHaqueSiam/xtend. The repo is private, so
# the download goes through the GitHub CLI and its login. Needs Node 24+ with npm.
#   sh scripts/install.sh           the latest published release
#   sh scripts/install.sh v0.2.0    a given tag (drafts too, for accounts that can see them)
set -eu

repo=EhsanulHaqueSiam/xtend
command -v gh >/dev/null 2>&1 || { echo "install.sh: needs the GitHub CLI (gh), logged in with gh auth login" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "install.sh: needs Node 24+ with npm" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' ||
  { echo "install.sh: needs Node 24+, found $(node --version)" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# shellcheck disable=SC2086 # no tag means the latest release
gh release download ${1:-} --repo "$repo" --pattern 'xtend-cli-*.tgz' --dir "$tmp"
npm install -g "$tmp"/xtend-cli-*.tgz
echo "install.sh: $(xtend --version) installed. Run xtend --help."
