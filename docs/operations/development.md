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
the environment variables listed in `apps/desktop/electron-builder.yml`. `pnpm release:smoke`
then checks that every packaged `.app` holds the Electron main, both preloads, the web app and
the service bundle.

## State

The service keeps everything under one base directory: `~/.xtend` by default, `--base-dir`
to override, `XTEND_HOME` as the environment equivalent. Dev always passes an explicit
`--base-dir` so a development server never touches the real data.

## Checks

- `pnpm check:changed` is the local version of CI for your branch: format and lint of the
  changed files, typecheck of their packages (all of them when contracts changed), knip, and
  the tests beside the changed files. Pass a ref to compare against something other than
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
  data dir and port. It passes once the supervisor's service answers, the xtend view has
  rendered and the window has loaded x.com. Linux needs `xvfb-run`.
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

Runners stay pinned. `ubuntu-latest` moved to 26.04 before Playwright supported it, and every
run failed at the browser install.

A `v*` tag runs `.github/workflows/release-desktop.yml` on macOS. It sets the desktop version
from the tag, runs `pnpm dist:desktop:dmg`, the same entry point as a local build, and
`pnpm release:smoke`. Only then does it publish a draft GitHub release with the dmgs, the zips,
their blockmaps and `latest-mac.yml`.
A manual run builds the same files as a workflow artifact.
Builds are unsigned until the `CSC_LINK` and `CSC_KEY_PASSWORD` secrets exist. Notarization
also needs the Apple ID secrets and `mac.notarize: true` in `electron-builder.yml`. The
updater only works on signed builds.
