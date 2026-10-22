# Development

## First checkout

Node 26 and pnpm 12 are pinned in `mise.toml`; `mise install` provides both. From the
repository root:

```sh
pnpm i
pnpm dev
```

`pnpm dev` runs the service (port 4820, state in the gitignored `<repo>/.corvid`) and the web
app (port 5820). The web app proxies `/ws` and `/api` to the service, so one origin works over
localhost and over the network alike.

`pnpm dev:desktop` bundles the Electron main process in watch mode and launches it against the
dev web server. It expects `pnpm dev` to be running.

## State

The service keeps everything under one base directory: `~/.corvid` by default, `--base-dir`
to override, `CORVID_HOME` as the environment equivalent. Dev always passes an explicit
`--base-dir` so a development server never touches the real data.

## Checks

- `pnpm typecheck` runs tsc-rs across the workspace. Do not use `npx tsc`.
- `vp test run <files>` runs focused tests. Web tests that render React are
  `*.browser.test.tsx` and run in headless Chromium; the first run downloads it with
  `pnpm exec playwright install chromium`.
- `pnpm lint` and `pnpm fmt`.
- `pnpm knip` fails on an unused export.

CI runs the full suite; locally, run the checks for what you changed.
