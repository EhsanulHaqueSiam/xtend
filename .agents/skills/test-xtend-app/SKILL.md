---
name: test-xtend-app
description: Verify Xtend's web and desktop UI through T3 Code's Browser panel against isolated dev state. Use for browser verification of a change and for seeding observation fixtures.
---

# Test the Xtend app

Use T3 Code's built-in Browser panel (`preview_status`, `preview_open`, `preview_navigate`,
`preview_snapshot`) for verification. If its tools are absent, explain the blocker and stop;
do not install another automation system.

## Start the app

Reuse this task's healthy dev processes. Otherwise, from the repository root:

```sh
pnpm dev                          # seeded demo data on first start, paid lanes fake
pnpm dev --fixture <name>         # one named UI state, in .xtend-fixtures/<name>; prints its URL
```

It prints the port pair, the state home and the lanes line; use the printed ports. Fixtures live
in `scripts/fixtures` (`first-run`, `failed-posts`, `budget-nearly-spent`, `x-screens`, ...): pick
the one that shows the change, or add one for it. Never point a dev service at `~/.xtend`; `--seed
real` copies it safely when the change needs real data.

Native X screens need the engine: in a plain browser add `?engine=all` (or named fixtures) to
the URL, which replays recorded X data. For the real engine, the desktop shell needs `pnpm dev`
running first and connects to the pair it printed:

```sh
pnpm dev:desktop
```

On a host without a display (the Mac mini over ssh), start it with `XTEND_REMOTE_DEBUG=9223`
(another free port when a second dev desktop holds 9223; `pnpm dev:ps` lists every checkout's
dev runs and desktops with their PIDs and DevTools ports) and drive it with
`node apps/desktop/scripts/cdp.mjs shot|eval|click|type|record|dump`. A dev desktop
started with `XTEND_SHOT_DIR` also writes a capture on `kill -USR2 <pid>`.

To learn what an X page requests, `cdp.mjs net x.com 15 --eval 'location.href = "<x url>"'`
prints each GraphQL call as `op  variables`; `--bodies <dir outside any repo>` keeps the
responses. Every `--eval` navigation is a real page load on the account: keep them few.

macOS has no `timeout`: use a command's own limit or `perl -e 'alarm shift; exec @ARGV' 30 <cmd>`.

## Inspect and bend state

`node apps/server/scripts/xtend-sqlite-state.ts query --base-dir <home> --sql "..."` reads the
dev database. `exec` writes one statement after a backup, refuses `~/.xtend`, and refuses while
the service holds the database: stop it first. Direct writes are for visual states; prove
behaviour through the service.

## Seed observations

The web UI shows what the desktop's x.com session observed. Without the desktop, post a batch
to the service directly; the body is the `ObservationBatch` schema from `packages/contracts`:

```sh
curl -s -X POST http://127.0.0.1:4820/api/observations -H 'content-type: application/json' \
  -d '{"viewerHandle":null,"source":"home","observedAt":"2026-10-22T05:10:00.000Z","posts":[{"postId":"1980000000000000001","author":{"userId":"5","handle":"levelsio","name":"Pieter","followers":621000,"verified":true},"text":"Shipped the thing.","createdAt":"2026-10-22T04:00:00.000Z","isReply":false,"hasMedia":false,"hasLink":false,"metrics":{"views":1100000,"likes":9800,"reposts":1200,"replies":412,"quotes":40,"bookmarks":900}}]}'
```

A second batch for the same post with a later `observedAt` appends a metrics row; the UI shows
the latest numbers and the sighting count.

## Engine changes: mock X first

Three tiers, cheapest first ([Mock X](../../../docs/operations/development.md#mock-x)):

- **Fixtures replay** (`?engine=all` in a browser): how a native screen draws engine data.
- **Mock X**: the whole loop with no account. `pnpm test:engine` drives Xtend's screens on the
  built desktop with mock X as the engine; add a check in `apps/e2e/src/engine` for the flow you
  changed, and teach mock X (`apps/e2e/src/mockX`) the page or button first if it lacks one.
  `pnpm mock-x --desktop` (with `pnpm dev` running) opens the dev desktop on it to look around.
- **Live bench**: whether x.com itself still behaves as the mock assumes. Only for what reads or
  presses X's real page in a new way.

Screenshots and recordings for a PR come from mock X or the fixtures, never the real account: the
repo is public.

## Engine changes: the live bench

What x.com itself sends and draws is proven only on the real account. A
worktree's dev desktop has its own `.xtend/electron` profile. `pnpm dev:x-session status` shows
which checkouts are signed in; `pnpm dev:x-session save --from <signed-in checkout>` (or
`--installed`, read only) keeps one session in `~/.xtend-dev`, and `pnpm dev:desktop` and new
worktrees start from it. It is the user's real X login: never commit, attach or share it.
The bench needs session actions on (Settings, X session). A seeded dev home has them off, so the
bench stops at once with a line naming the setting instead of failing its press checks.
The repo is public: the session, unscrubbed recordings, bench results and screenshots of the real
account stay out of commits, PR bodies and comments (AGENTS.md "Publishing the account"). Then, with the
dev desktop on `XTEND_REMOTE_DEBUG=<port>`:

```sh
XTEND_REMOTE_DEBUG=<port> node apps/desktop/scripts/engine-bench.mjs --only <area>   # while iterating
XTEND_REMOTE_DEBUG=<port> node apps/desktop/scripts/engine-bench.mjs --runs 3 --pause 300
```

- The bench refuses to start under 5 minutes after the account's last run, or while more than 4
  runs started in the last 30 minutes (from its results files, any branch), and prints when it
  may run again. Don't `--force` it to retry a failure: when many checks fail at once with empty
  lists it prints a rate-limit hint, and the cure is waiting 15 to 30 minutes.
- Three clean runs in a row, five minutes apart, are the proof an engine PR names. Each run's
  table and timings land in `~/Pictures/xtend-ui/bench/<branch>/<time>.json` (the last line
  prints the path); cite that file's summary, and diff it against main's to spot a slower check. X rate-limits an
  account per 15 minutes and a run is a few hundred calls; heavy reloading has earned the account
  HTTP 429s on every device.
- The bench presses no X write button except one bookmark it removes again. Never press like,
  reply, repost, follow, vote or post from a script on the real account; only the user's click does.
- Check `curl -s http://127.0.0.1:<port>/json` lists the app page and the x.com webview before a
  run: a closed window leaves the process up with no pages, and the bench then fails at once.
- Don't edit files the dev desktop serves while a bench runs: hot reload restarts the screen
  mid-check. Work in another worktree meanwhile.

## Free and paid

Fake-service screen tests, seeded observations and session-lane reads are free. X API calls through
treg and model calls spend the user's balance: use them only when the change depends on that lane,
and say what it cost. Keep the treg token, X handles' DMs and cookies out of screenshots you share.

## Capture evidence

`pnpm capture --routes /a,/b --viewports 1440x900,390x844 --label after` screenshots the running
dev app into `~/Pictures/xtend-ui/<branch>/` and prints Markdown embeds. For before/after, run the
same fixture with the same `--clock` on main's checkout (`--label before`) and on the branch.

## Verify and retain

Open `http://localhost:5820/<route>` in the Browser panel, exercise the affected flow, and
capture the state that proves it works with `preview_snapshot` (`save: true`). Keep the
processes and the panel available while the user inspects. Stop only processes you started,
by the PID you captured.
