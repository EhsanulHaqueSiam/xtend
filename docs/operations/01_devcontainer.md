# Dev container

`.devcontainer/` gives a Linux environment that matches CI: Node at the `mise.toml` pin, pnpm
at the `packageManager` pin, the GitHub CLI, Playwright's headless Chromium, the Electron
binary and xvfb. Dependencies are installed before you attach. Open the repo in VS Code
("Reopen in Container"), create a Codespace, or use the CLI:

```sh
npx -y @devcontainers/cli@latest up --workspace-folder .
npx -y @devcontainers/cli@latest exec --workspace-folder . bash -l
```

## What works

- `pnpm dev` with the demo seed and the local fake for treg, the pool and AI assist. The
  container pins `XTEND_PORT_OFFSET=0`, so the pair is always service 4820 and web 5820, and
  both are forwarded. Open the web port; it proxies `/ws` and `/api` to the service.
- `pnpm check:changed`, `vp test run <files>`, browser tests (`*.browser.test.tsx`) and the
  e2e journeys, which run in the installed Chromium.
- The Electron suites, as CI runs them: `xvfb-run -a pnpm test:engine` (it builds what it
  needs) and, after `pnpm build`, `xvfb-run -a pnpm --filter @xtend/desktop smoke-test`.

## State

`XTEND_HOME` points at the workspace's `.xtend`, the same home `pnpm dev` uses, so the CLI and a
bare service run never write anywhere else. It is a volume of the container's own: the host
checkout's `.xtend` stays the host's, so a host `pnpm dev` and a container one never share a
database or a scheduler. Nothing from the host's home is
mounted: no `~/.xtend`, no `~/.xtend-dev`, no Electron profile. Keep it that way; a mounted
live home would run a second scheduler on the user's database.

A named volume, scoped by the container's id, holds the root `node_modules` and the pnpm store
inside it (`node_modules/.pnpm-store`), so rebuilds stay fast and off the slow host bind mount.
The host sees an empty `node_modules`; run tooling inside the container. Deleting the container
leaves the volume; `docker volume ls | grep xtend-` lists it.

## Out of scope

- A signed-in dev desktop, `pnpm dev:x-session`, `--seed real` and the engine bench. They need
  the user's X session, which never enters the container. Run them on the host.
- Windowed Electron (`pnpm dev:desktop`) and the macOS release build.
- Git inside the container when the workspace is a linked worktree: its `.git` file points at
  a host path. Open a full clone instead.

## Prebuilds

Codespaces prebuilds run `onCreateCommand` and `updateContentCommand` for you, but their
snapshots skip named volumes; drop the mount if prebuilds become the main path. Outside
Codespaces, push a prebuilt image with:

```sh
npx -y @devcontainers/cli@latest build --workspace-folder . --push true --image-name <registry>/xtend-devcontainer:latest
```
