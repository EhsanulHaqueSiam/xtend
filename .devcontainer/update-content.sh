#!/usr/bin/env bash
# Runs at creation and on every prebuild content refresh. Everything here is idempotent.
set -euo pipefail

# The node_modules volume arrives root-owned; hand it to the dev user before installing.
if [ "$(stat -c %U node_modules)" != "$(id -un)" ]; then
  sudo chown "$(id -un):$(id -gn)" node_modules
fi

pnpm install --frozen-lockfile
# No install script since Electron 44; this fetches the binary, same as CI.
pnpm --filter @xtend/desktop ensure:electron

# Playwright's headless Chromium for *.browser.test.* and the e2e journeys, as in
# .github/actions/chromium. Unlike CI's runner the base image has none of its system libraries,
# and install refuses to run without them; they also cover Electron's.
playwright=apps/web/node_modules/playwright/cli.js
sudo env "PATH=$PATH" node "$playwright" install-deps chromium
node "$playwright" install --only-shell chromium
