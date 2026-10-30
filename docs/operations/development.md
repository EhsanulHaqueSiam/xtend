# Development

## First checkout

Node 26 and pnpm 12 are pinned in `mise.toml`; `mise install` provides both. From the
repository root:

```sh
pnpm i
pnpm dev
```

`pnpm dev` runs the service (state in the gitignored `<repo>/.xtend`) and the web app, and
prints both URLs. The web app proxies `/ws` and `/api` to the service, so one origin works over
localhost and over the network alike. `pnpm dev:server` and `pnpm dev:web` start one of the two.

Each checkout gets its own port pair from `scripts/dev-runner.ts`, so several checkouts and T3
worktrees run at once. The main checkout starts at service 4820 and web 5820, a linked worktree
at an offset hashed from its path, and `XTEND_PORT_OFFSET=<n>` pins the offset. When a port of
the pair is taken, the next free pair wins. The runner hands the pair to the processes as
`XTEND_PORT` and `XTEND_WEB_PORT`; without the runner, `vp dev` and `pnpm --filter xtend dev`
keep 4820 and 5820.

`pnpm dev:desktop` bundles the Electron main process in watch mode and launches it against the
pair `pnpm dev` recorded in `.xtend/dev-ports.json`, reading the service token from this
checkout's `.xtend`. It expects `pnpm dev` to be running. On any pair but the default, Electron
keeps its user data (x.com session included) in `.xtend/electron`, so two dev desktops can run at
once.

`pnpm dist:desktop:dmg` builds the web app, the service bundle and the Electron main, verifies
the preloads, then runs electron-builder for macOS: a dmg and a zip for arm64 and x64 in
`apps/desktop/release`. `pnpm dist:desktop:dmg:arm64` and `pnpm dist:desktop:dmg:x64` build one
architecture; they name the `dmg zip` targets because the per-target arch list in
`electron-builder.yml` beats a bare `--arm64`. `pnpm build:desktop` is the same as
`pnpm dist:desktop:dmg`. Without `CSC_LINK` the build is unsigned; signing and notarization need
the environment variables listed in `apps/desktop/electron-builder.yml`.

`pnpm dist:desktop:appimage` builds the Linux AppImage (x64, for Arch or any glibc distro) into
the same directory. Linux needs no signing, and the updater reads `latest-linux.yml`. On Apple
Silicon the AppImage step runs an x86_64 tool, so it needs Rosetta
(`softwareupdate --install-rosetta`); CI builds it on Linux.

`pnpm release:smoke` checks every packaged app there: the Electron main and both preloads in
`app.asar`, the web app and the service bundle beside it. For an app built for this machine it
also copies the packaged files out and starts the service with the app's own Electron as Node,
waiting for `/api/health`, so a dependency the bundle expects but the app lacks fails here.

## Worktrees

T3 Code runs `scripts/setup-worktree.ts` when it creates a worktree (`t3.json`): a frozen
install, with `.t3/setup-running`, `.t3/setup-done` or `.t3/setup-failed` as markers for agents.
`.xtend` is never copied into a worktree: two services on one database would both run the
scheduler and post the same drafts.

## CLI package

`pnpm build && pnpm cli:pack` writes `dist-cli/xtend-cli-<version>.tgz`: the bundled service with
the web app beside it, `xtend` as its command. `pnpm cli:pack --check` also installs it into a
throwaway prefix and checks the installed command serves the app. AI assist runs the user's own
`claude` or `codex` CLI, found on the login shell's PATH, so the package has no dependencies.
Releases carry the tarball, and `scripts/install.sh [tag]` installs
it from one through the GitHub CLI, since the repo is private. It needs Node 24 or newer.

## State

The service keeps everything under one base directory: `~/.xtend` by default, `--base-dir`
to override, `XTEND_HOME` as the environment equivalent. Dev always passes an explicit
`--base-dir` so a development server never touches the real data.

## Checks

- `pnpm check:changed` is the local version of CI for your branch: format and lint of the
  changed files, typecheck of the packages CI's change detection picks for them
  (`.github/scripts/ci-changes.cjs`), knip, and the tests beside the changed files. Pass a ref to compare against something other than
  `origin/main`. Uncommitted and untracked files count.
- `pnpm typecheck` runs tsc-rs across the workspace. Do not use `npx tsc`.
- `vp test run <files>` runs focused tests. `pnpm test` also runs the tests under `scripts/`
  with the root config; alone, that is `vp test run --dir scripts`. Anything that renders React or touches the DOM is
  `*.browser.test.{ts,tsx}` and runs in headless Chromium; the first run downloads it with
  `pnpm exec playwright install chromium`.
- `pnpm lint` and `pnpm fmt`. A pre-commit hook (`.vite-hooks/pre-commit`, installed by
  `pnpm i`) formats the staged files.
- `pnpm knip` fails on an unused file, export or dependency.

## Screen tests

`render(ui, { service })` from `apps/web/test/render.tsx` runs the tree against a fake service:
`service` maps rpc names to handlers typed by the contracts, and `test/fakeService.ts` puts
Effect's in-memory rpc client and server behind them, so atoms go through the same request
path as in production. Live events default to none. An rpc the test did not answer dies with
its name. `installFakeBridge` from `test/fakeBridge.ts` plays the desktop.
`src/components/shell/GlanceSync.browser.test.tsx` is the worked example.

## Desktop checks

Both need `pnpm build` first.

- `pnpm --filter @xtend/desktop verify:bundles` runs the two preloads in a stand-in for
  Electron's sandbox. It fails when a preload requires anything but `electron` and the few
  modules a sandboxed preload may load, when `desktopBridge` lacks a function declared in
  `apps/web/src/desktopBridge.ts`, or when the x.com preload stops listening on a channel main
  sends it.
- `pnpm --filter @xtend/desktop smoke-test` boots the built app on a throwaway state dir, user
  data dir and port. It passes once the supervisor's service answers, the app has rendered
  and its webview has loaded x.com. Linux needs `xvfb-run`.
- `node apps/desktop/scripts/cdp.mjs shot|eval|click|type` drives a dev desktop started with
  `XTEND_REMOTE_DEBUG=9223` on a host without a display. See
  [native-shell.md](../internals/native-shell.md#dev-capture) for its limits.

## CI and releases

`.github/workflows/ci.yml` runs three jobs on `ubuntu-24.04`, each set up by
`.github/actions/setup`:

| job   | runs                                                                                 |
| ----- | ------------------------------------------------------------------------------------ |
| check | `fmt:check`, `lint`, `knip`                                                          |
| build | `typecheck`, `build`, `verify:bundles`, then the desktop smoke test under `xvfb-run` |
| test  | every package's tests, with the Chromium headless shell cached by Playwright version |

A `changes` job first reads the changed paths (a pull request against its base, a push to `main`
against the commit before it) and `.github/scripts/ci-changes.cjs` decides what runs. `check`
always runs. Docs, root `*.md`, `.agents/`, `.vite-hooks/` and `knip.jsonc` alone run nothing
else. Root `scripts/` alone run `test` but not `build`. Any change in `apps/` or `packages/`
runs both: the smoke test boots the server and renders the web app. Contracts, a manifest, the
lockfile, a root config, `.github/` or any path the script does not know runs everything, as
does a base it cannot read, such as after a force push. A skipped job reports success, so the
three job names can be required checks. `pnpm check:changed` typechecks the packages the same
mapping returns. The script is tested by `node --test .github/scripts`, part of `pnpm test`.

Runners stay pinned. `ubuntu-latest` moved to 26.04 before Playwright supported it, and every
run failed at the browser install.

A `v*` tag runs `.github/workflows/release-desktop.yml`. A macOS job builds the dmgs and zips
with `pnpm dist:desktop:dmg`, a Linux job the AppImage with `pnpm dist:desktop:appimage` and the
CLI tarball with `pnpm cli:pack --check`, both taking the version from the tag and running
`pnpm release:smoke`. Only when both pass does a third job publish one draft GitHub release with
all the files, their blockmaps, `latest-mac.yml` and `latest-linux.yml`. A manual run builds the
same files as workflow artifacts. macOS builds are unsigned until the `CSC_LINK` and
`CSC_KEY_PASSWORD` secrets exist; notarization also needs the Apple ID secrets and
`mac.notarize: true` in `electron-builder.yml`, and the macOS updater only works on signed builds.

`.github/workflows/desktop-preview.yml` builds an unsigned arm64 macOS app and the AppImage for
every pull request that touches the app, runs `pnpm release:smoke` on each, and uploads them as
artifacts for 14 days, linked from the run summary. A manual run picks macOS, Linux or both.
macOS runner minutes count ten times on a private repo.
