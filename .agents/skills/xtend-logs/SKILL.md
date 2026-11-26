---
name: xtend-logs
description: Find and read an Xtend service's logs and traces, for a dev run in this checkout or a user's installed app. Use when a screen fails, a post did not go out, a rule misfired, the service will not start, or something is slow, before guessing at the cause.
---

# Xtend logs and traces

The full reference is [the observability runbook](../../../docs/operations/03_observability.md).
This is what an agent gets wrong without it.

## Which base dir

Every file lives under the service's base dir. Pick it before reading anything:

| run                    | base dir                                                |
| ---------------------- | ------------------------------------------------------- |
| `pnpm dev`             | `<repo>/.xtend` (`.xtend/dev-ports.json` has its ports) |
| `pnpm dev --fixture X` | `<repo>/.xtend-fixtures/X`                              |
| installed app, launchd | `~/.xtend`, or `XTEND_HOME`                             |

`pnpm dev:ps` lists every checkout's dev runs and desktops with their ports. `~/.xtend` belongs to
the user's live install: read and copy from it, never start a service on it or write to it.

## Files

- `logs/service.trace.ndjson` (rotated `.1` newest to `.5`): one line per finished span. Start here.
- `service.log`: the service's stdout when the desktop or launchd runs it. Under `pnpm dev` stdout
  goes to that terminal instead, so there is no `service.log`.
- `logs/desktop.log` (rotated `.1` to `.3`): the desktop's main process: service child starts and
  exits, renderer and x.com view crashes, pages that failed to load.

## Commands

All read-only, safe beside a running service, and they spend nothing. In a checkout run the CLI as
`node apps/server/src/bin.ts`; an install has `xtend` on the PATH. `--base-dir` picks the home.

```sh
node apps/server/src/bin.ts --base-dir .xtend trace --since 30m              # per-span count, p50, p95, max, failures, then latest failures
node apps/server/src/bin.ts --base-dir .xtend trace --since 2h --limit 50
node apps/server/src/bin.ts --base-dir .xtend doctor                         # base dir, db, service, trace age, treg token set, assist CLIs, launchd
xtend trace --since 1h                                                       # the user's install
xtend service status                                                         # launchd agent installed and loaded
```

`trace` reads the files directly, so it works with the service stopped or stuck. `doctor` exits 1
when a check fails. For one trace's tree, slow spans or spend by purpose, use the runbook's `jq`
recipes on the trace file.

## Reading a span

- `http.rpc.<method>` and `ws.rpc.<method>` are the transports; the service operation under them is
  `Service.operation` (`Effect.fn` names), and `sqlite` spans are its queries.
- A failed span has `exit._tag: "Failure"` with `errorTag` and a scrubbed `cause`. Search the
  source for the tag (`ComposeError`, `AutomateError`) and the span name to find the code.
- `Treg.call` spans carry `x.purpose`, `x.endpoint`, `x.cost_usd` and `x.cached`: that is where
  money went and whether a read came from cache.
- `service.eventLoop.stall` is a stall over 2 s; `Unhandled defect` in a span's events is an
  unexpected error rather than a typed failure.

## Never

- Read `auth-token`, `~/.treg/config.json`, the app's Electron profile or a heap snapshot, or print
  environment variables. The logs are scrubbed of tokens and cookies; those files are not.
- Paste handles, post or draft text, or paths under the user's home from these files into an issue,
  PR or commit. The repo is public.
- `kill -USR2` a process you have not checked with `ps -p <pid> -o command=`: the desktop exits on
  it, and the snapshot holds every token in memory.
