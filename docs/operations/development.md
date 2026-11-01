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
checkout's `.xtend`. It expects `pnpm dev` to be running. Electron keeps its user data (x.com
session included) in `<home>/electron`, never the installed app's profile, so dev desktops of
several checkouts run beside the installed app.

### Signed-in dev desktop

A new profile is signed out of X. Sign in once, then save that session for every checkout, as
T3 Code's reusable dev credential does for its pairing cookie:

```sh
pnpm dev:x-session save                    # this checkout's dev desktop
pnpm dev:x-session save --from <checkout>  # another checkout's (or a user data dir)
pnpm dev:x-session save --installed        # the installed app's profile, read only
pnpm dev:x-session use                     # copy it into this checkout's profile
pnpm dev:x-session status                  # saved, here, and every other checkout
```

The copy lives in `~/.xtend-dev/x-session` (owner-only, never `~/.xtend`) without Chromium's
caches, a few MB. `pnpm dev:desktop` and the Setup Worktree action copy it into a signed-out
profile on their own; `use` refuses while this checkout's dev desktop holds the profile. It is
account 1's partition, which is what a dev home starts with. The installed app's profile is
`~/Library/Application Support/Xtend` on macOS and `~/.config/Xtend` on Linux.

The saved session is your real X login. Anyone with the folder acts as you on X: never commit
it, attach it to a PR, copy it to another machine or share it. `rm -rf ~/.xtend-dev/x-session`
forgets it; signing out on x.com ends it everywhere. `save` refuses a source whose desktop (or
the installed app) is running, since the copy would be torn; quit it first.

The repo is public. Nothing from the real account goes into it, a PR body or a comment: the X
session, recordings that are not scrubbed (`pnpm engine-fixture scrub`), bench results or logs
with real handles, screenshots of the real account. PR evidence comes from fixtures
(`pnpm capture`). `node scripts/check-no-x-session.ts` runs in the pre-commit hook on staged
files and in CI's lint job on the whole tree. It rejects profile directories (`Partitions`,
`x-session`, `Local Storage`, ...), session and database files (`Cookies`, `*.sqlite*`,
`*.ldb`, `auth-token`), X cookie values, and engine fixtures with real ids, handles, `twimg.com`
images or t.co links.

### Dev processes

`pnpm dev:ps` lists every checkout's dev run and dev desktop (`git worktree list`) with its PID,
ports, DevTools port, uptime and whether the PID is alive, from the records `pnpm dev` and the
desktop launcher keep in `.xtend/dev-ports.json` and `.xtend/dev-desktop.json` while they run.
It only prints. Stop a process from the terminal that started it, or by a PID listed for your
own checkout; never by name (AGENTS.md "Ways to hurt yourself").

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
scheduler and post the same drafts. A session saved with `pnpm dev:x-session save` is copied into the new
worktree's dev desktop profile, so it starts signed in to X.

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
`--base-dir` (`<repo>/.xtend`, or `pnpm dev --home <dir>`) so a development server never touches
the real data.

## Dev data and UI states

An empty database is a bad test. `pnpm dev` seeds a fresh home on its first start
(`apps/server/scripts/seed-dev.ts`): every screen has data (posts with metric history, drafts in
every status, rules with runs, people, lists, library, inbox, spend), times shifted to now, and
nothing that acts on its own: rules and agents off, nothing due, session posting off, pool
sharing off, no treg token.

- **Paid lanes are fake.** Dev points treg, the pool and AI assist at a local fake
  (`apps/e2e/src/fakeTreg.ts`, the one the e2e journeys use); the runner prints the lanes line.
  `--live` sends treg and the pool to the real services and spends the balance.
- **Seeds.** `--seed demo` (default, `XTEND_DEV_SEED`), `--seed real` copies `~/.xtend`
  read-only (`copy-dev-db.ts`: recent rows only, the same neutralizing, tokens and secrets dropped,
  never the auth token or the Electron profile), `--seed none` starts empty. A seed runs only when
  the home has no database; move `.xtend` aside to reseed.
- **Fixtures** reproduce one UI state: `pnpm dev --fixture <name> [--fresh]` seeds
  `.xtend-fixtures/<name>`, applies the fixture's SQL and prints the URL that shows it.
  A fixture is `scripts/fixtures/<name>.json` (`description`, `seed`, `frozen`, `sql`, `open`).
  Write one per bug or edge case worth seeing again; direct SQL is for visual states only.
- **X screens without the desktop.** `?engine=home,post` (or `all`) on any dev URL replays engine
  fixtures from `apps/web/test/fixtures/engine` into the native screens; `window.xtendDev` has
  `replay(name)` and `fixtures()`. `pnpm engine-fixture synth` rewrites the made-up set;
  `cdp.mjs record` / `dump` on a running dev desktop records real batches outside the repo, and
  `pnpm engine-fixture scrub <recording> <name>` replaces every id, handle, name, text and image
  before anything is committed.
- **Inspecting state.** `node apps/server/scripts/xtend-sqlite-state.ts query|exec --base-dir <home>
  --sql ...`: `query` is read-only; `exec` refuses `~/.xtend` and an open database and backs up
  first.
- **Evidence.** `pnpm capture --routes /a,/b [--viewports 1440x900,390x844] [--clock <iso>]
  [--label before|after]` screenshots the running dev app into `~/Pictures/xtend-ui/<branch>/` and
  prints Markdown embeds. Before/after: the same fixture and clock on main's checkout and on the
  branch. A `frozen` fixture with `--clock 2026-10-28T09:00:00Z` (the seed's clock) captures the
  same pixels every run. Upload images for a PR; never commit them.

## Checks

- `pnpm check:changed` is the local version of CI for your branch: format and lint of the
  changed files (every file when a lint rule or the config changed), typecheck of the packages CI's
  change detection picks for them (`.github/scripts/ci-changes.cjs`), knip, the tests beside the
  changed files, the payload budgets when the service is affected, and a lockfile and patch check
  when a manifest, the lockfile or `patches/` changed. Steps run in parallel within the machine's
  budget (`--concurrency`, `--timeout`); a rerun on identical input prints the last passing summary.
  Pass a ref to compare against something other than the closest remote `main`.
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
- `cdp.mjs net x.com [seconds] [--eval <expr>] [--bodies <dir>]` prints every X GraphQL call the
  webview makes as `op  variables`, for learning what an X page requests. `--eval` runs first,
  usually a navigation; each one is a real page load on the account, so keep them few.
  `--bodies` writes the responses to a directory outside any git checkout: they are your data.
- The engine bench (`engine-bench.mjs`) refuses to start while session actions are off: its
  press checks go through the app's X buttons. A seeded dev home starts with them off; turn on
  Settings, X session, "Act through my X session for what I click" in the dev desktop. It also
  stops when Settings, Account, Handle names someone other than the account the engine is signed
  in as (the seed sets one): screens like Lists open that handle's pages. Each run's
  results go to `~/Pictures/xtend-ui/bench/<branch>/<time>.json` (every check's pass, time and
  detail, the commit and flags) for comparing runs and citing in a PR.
- macOS has no `timeout` command. Bound a command with its own limit (`cdp.mjs net <seconds>`,
  `check:changed --timeout`, `curl --max-time`) or `perl -e 'alarm shift; exec @ARGV' 30 <cmd>`.

## CI and releases

`.github/workflows/ci.yml` runs on `ubuntu-24.04`, each job set up by `.github/actions/setup`:

| job   | runs                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| lint  | rejects committed PR evidence (`.github/pr-assets`), then `fmt:check`, `lint`, `knip`                      |
| build | `typecheck`, `build`, the route tree is current, `verify:bundles`, the desktop smoke test under `xvfb-run` |
| test  | every package's tests and the e2e journeys, Chromium from `.github/actions/chromium`                       |
| Check | passes only when every job above passed or was skipped because its gate said so                            |

A `changes` job first reads the changed paths of a pull request against its base, and
`.github/scripts/ci-changes.cjs` decides what runs; a push to `main` runs everything as the
backstop. `lint` always runs. Docs, root `*.md`, `.agents/` and `.vite-hooks/` alone run nothing
else; root `scripts/` alone run `test` but not `build`; the lint plugin reaches only itself. Any
other change in `apps/` or `packages/` runs both: the smoke test boots the server and renders the
web app. Contracts, a manifest, the lockfile, a root config, `.github/` or any path the script
does not know runs everything, as does a base it cannot read. `pnpm check:changed` typechecks the
packages the same mapping returns. The script is tested by `node --test .github/scripts`.

`.github/workflows/payload-budget.yml` compares `apps/server/src/payloadBudget.json` with main's
and fails when a WebSocket payload grew, unless the PR has the `payload-increase` label.

Runners stay pinned. `ubuntu-latest` moved to 26.04 before Playwright supported it, and every
run failed at the browser install.

`.github/workflows/release-desktop.yml` ships two channels, as T3 Code does. A push to `main`
that touches the app is a **nightly**: version `X.Y.Z-nightly.YYYYMMDD.RUN`, where `X.Y.Z` is one
patch past the newest `vX.Y.Z` tag, published as a GitHub prerelease. Merges in a row cancel the
older run, so only the newest builds. A `vX.Y.Z` tag is **stable**, published as the latest
release; to promote a nightly, tag its commit. CI runs first on the commit being shipped (`ci.yml` as a reusable workflow), and a stable tag must
point at a commit already on `main`. A version job picks the version once; a macOS job
builds the dmgs and zips with `pnpm dist:desktop:dmg`, a Linux job the AppImage with
`pnpm dist:desktop:appimage` and the CLI tarball with `pnpm cli:pack --check`, both stamping the
version and running `pnpm release:smoke`. Only when both pass does a third job publish the
release with every file. electron-builder names the updater files after the channel in the
version: `latest-*.yml` for stable, `nightly-*.yml` for nightlies. A manual run builds the same
files as workflow artifacts and publishes nothing.

The app (`apps/desktop/src/updates.ts`) follows the channel it was built on until the user picks
the other in Settings, Service, checks at start and hourly, and shows "Restart to update" once a
build is downloaded. macOS builds are unsigned until the `CSC_LINK` and `CSC_KEY_PASSWORD`
secrets exist, and Squirrel.Mac will not install into an unsigned app, so on macOS the app links
to the release instead; notarization also needs the Apple ID secrets and `mac.notarize: true`
in `electron-builder.yml`. The repo is public, which the updater needs: GitHub Releases of a
private repo need a token the app must not carry.

`.github/workflows/desktop-preview.yml` builds an unsigned arm64 macOS app and the AppImage for
every pull request that touches the app, runs `pnpm release:smoke` on each, and uploads them as
artifacts for 14 days, linked from the run summary. A manual run picks macOS, Linux or both.
Runner minutes are free on a public repo.
