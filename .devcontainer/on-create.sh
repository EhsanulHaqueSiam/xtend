#!/usr/bin/env bash
# One-time container setup, baked into prebuilds. Work that depends on the checkout's
# dependencies (install, Chromium, Electron) lives in update-content.sh.
set -euo pipefail

# pnpm at the version package.json pins, the same source CI's pnpm/action-setup reads.
# vp is a dev dependency (pnpm exec vp), so nothing else is installed globally.
pnpm_spec=$(node -p 'require("./package.json").packageManager')
sudo env "PATH=$PATH" npm install -g "$pnpm_spec"

# The Electron suites run under xvfb-run, as in CI. Electron also needs GTK, which Playwright's
# Chromium libraries (update-content.sh) leave out.
sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb libgtk-3-0t64

# First-run terminal notice, rendered by the devcontainers base image.
sudo mkdir -p /usr/local/etc/vscode-dev-containers
sudo tee /usr/local/etc/vscode-dev-containers/first-run-notice.txt >/dev/null <<'EOF'
Xtend dev container

  pnpm dev                    service + web on 4820 / 5820, demo data in .xtend
  pnpm check:changed          checks for what you changed
  pnpm build && xvfb-run -a pnpm test:engine
                              Electron engine suite on mock X

No X session lives here: dev desktops and the engine bench stay on the host.
Details: docs/operations/01_devcontainer.md
EOF
