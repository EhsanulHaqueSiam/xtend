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
pnpm dev
```

This runs the service on `http://127.0.0.1:4820` with state in the gitignored `<repo>/.xtend`
and the web app on `http://localhost:5820`. Never point a dev service at `~/.xtend`.

The desktop shell needs the dev web server running first:

```sh
pnpm dev:desktop
```

## Seed observations

The web UI shows what the desktop's x.com session observed. Without the desktop, post a batch
to the service directly; the body is the `ObservationBatch` schema from `packages/contracts`:

```sh
curl -s -X POST http://127.0.0.1:4820/api/observations -H 'content-type: application/json' \
  -d '{"viewerHandle":null,"source":"home","observedAt":"2026-10-22T05:10:00.000Z","posts":[{"postId":"1980000000000000001","author":{"userId":"5","handle":"levelsio","name":"Pieter","followers":621000,"verified":true},"text":"Shipped the thing.","createdAt":"2026-10-22T04:00:00.000Z","isReply":false,"hasMedia":false,"hasLink":false,"metrics":{"views":1100000,"likes":9800,"reposts":1200,"replies":412,"quotes":40,"bookmarks":900}}]}'
```

A second batch for the same post with a later `observedAt` appends a metrics row; the UI shows
the latest numbers and the sighting count.

## Verify and retain

Open `http://localhost:5820/<route>` in the Browser panel, exercise the affected flow, and
capture the state that proves it works with `preview_snapshot` (`save: true`). Keep the
processes and the panel available while the user inspects. Stop only processes you started,
by the PID you captured.
