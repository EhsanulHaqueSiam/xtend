#!/usr/bin/env bash
# Runs at creation and on every prebuild content refresh. Everything here is idempotent.
set -euo pipefail

# The volumes arrive root-owned; hand them to the dev user before installing.
for dir in node_modules .xtend; do
  if [ "$(stat -c %U "$dir")" != "$(id -un)" ]; then
    sudo chown "$(id -un):$(id -gn)" "$dir"
  fi
done

pnpm install --frozen-lockfile
# No install script since Electron 44; this fetches the binary, same as CI.
pnpm --filter @xtend/desktop ensure:electron
# .repos/ (AGENTS.md). Needs git, which a linked worktree's .git file does not give the container.
pnpm sync:repos || echo "[devcontainer] .repos not linked; run pnpm sync:repos in a full clone"

# Playwright's headless Chromium for *.browser.test.* and the e2e journeys, as in
# .github/actions/chromium. Unlike CI's runner the base image has none of its system libraries,
# and install refuses to run without them; they also cover Electron's.
playwright=apps/web/node_modules/playwright/cli.js
sudo env "PATH=$PATH" node "$playwright" install-deps chromium
node "$playwright" install --only-shell chromium
