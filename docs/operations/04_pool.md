# Pool database and worker

The shared pool is the Neon project `xtend-pool` (Singapore), reached only through the
Cloudflare Worker `xtend-pool` (`infra/pool`) over Hyperdrive. The schema is
`apps/server/src/pool/schema.sql` and re-applies in place.

```sh
neon connection-string --project-id <id>          # from the Neon CLI, logged in to the org
psql "$XTEND_POOL_URL" -1 -v ON_ERROR_STOP=1 -f apps/server/src/pool/schema.sql
```

Apply the schema before deploying a worker that needs it; `-1` makes it one transaction so the
running worker never sees a function half replaced.

Never put the connection string in the repo, the service or the desktop. It lives in the
Hyperdrive config (Cloudflare dashboard, or `npx wrangler hyperdrive list`) with query caching
off: `pool_register` and `pool_flush` are selects with side effects, and a cached select would
skip them.

## Worker

The worker is deployed with alchemy (`infra/pool/alchemy.run.ts`), as T3 Code deploys its own.
Alchemy only reads the Hyperdrive config by id; it never creates, changes or deletes it.
Credentials: `alchemy profile` login, or `CLOUDFLARE_ACCOUNT_ID` with `CLOUDFLARE_API_TOKEN`; a
token needs at least Workers Scripts edit, Hyperdrive read and Secrets Store edit.

Plan and deploy keep alchemy's state in the account (`Cloudflare.state()`), so it outlives the
worktree that ran them. The first plan creates that store: an `alchemy-state-store` worker and
its secrets in a Secrets Store. `dev` keeps its state in `infra/pool/.alchemy/` (gitignored) and
creates nothing in the account. An interactive plan makes the store, or offers to upgrade an old
one; with `CI` set it fails instead, so make it once first with
`pnpm --filter @xtend/pool exec alchemy state bootstrap`.

```sh
pnpm --filter @xtend/pool run plan      # what a deploy would change; the first also makes the store
pnpm --filter @xtend/pool run deploy    # logged in to the account that owns it
```

`run` is needed: `pnpm deploy` without it is pnpm's own command, not the script.

The first alchemy deploy takes over the worker wrangler made. Run it once with `--adopt`, plan
first, and read the plan before deploying:

```sh
pnpm --filter @xtend/pool exec alchemy plan --stage prod --adopt
pnpm --filter @xtend/pool exec alchemy deploy --stage prod --adopt
```

The PoolBuffer object keeps its data: alchemy matches the `BUFFER` binding to the live class by
name, so the class must stay `PoolBuffer`. That deploy also adds alchemy's ownership tags and
the `new_module_registry` compatibility flag, and ships alchemy's bundle of the same code, so
run the local check under [Operating it](#operating-it) first.

It is one way: alchemy declares `PoolBuffer` as an export, and Cloudflare then rejects
wrangler's old `migrations` upload, so recovery is always another alchemy deploy. Reverting the
code does not undo the adopting deploy, since the code did not change; if the adopted worker
misbehaves, set `compatibility.flags: ["legacy_module_registry"]` in `alchemy.run.ts` and
deploy again. The worker is retained: `alchemy destroy`, or renaming it in `alchemy.run.ts`,
makes alchemy forget it, never delete it.

The pool pins effect 4.1.5, which alchemy needs; the rest of the workspace is on the catalog's
4.0.5, so `.repos/effect` shows 4.0.5's API, not the pool's.

| route                       | does                                                    |
| --------------------------- | ------------------------------------------------------- |
| `POST /register`            | an install id, from Neon; 5 per minute per address      |
| `POST /push` + `x-install`  | `{ items: [...] }` up to 500, queued (202); 30 a minute |
| `GET /trends/hot?limit=`    | `pool_hot_posts` from the hourly snapshot, up to 100    |
| `GET /trends/rising?limit=` | `pool_rising_terms` from the hourly snapshot, up to 100 |
| `GET /health`               |                                                         |

Pushes wait in the `PoolBuffer` Durable Object. The hourly cron flushes them through
`pool_flush`, refreshes both views and stores the snapshot trends are served from; an hour with
no pushes does not wake Neon. Logs and errors are in Workers observability.

## Free plan budget

Neon's free plan gives 100 CU-hours a month and suspends compute five minutes after the last
query, so cost is minutes awake, not rows: an hourly flush is about 24 wakes of six minutes at
0.25 CU, about 18 CU-hours a month, whatever the traffic. Keep the compute's max size at 0.25 CU
in Neon so a refresh cannot scale it up. Registrations, and the first push from an install the buffer has not seen, still wake Neon
(about 0.02 CU-hours each). The ceilings that remain are Neon's 0.5 GB of storage and Cloudflare's 100,000 Worker and
Durable Object requests a day (one each per push or trends read).

## Operating it

- `select pool_register()` and `select pool_flush('[{"install":..,"at":..,"body":{"items":[..]}}]')`
  are what the worker calls; run them by hand to test a schema change. `pool_flush` returns the
  accepted count, the pushes it dropped and the installs it did not know.
- Local check: a local Postgres with the schema applied, then the worker on it (logged in: dev
  still reads the Hyperdrive config by id) and one pass through every route:

  ```sh
  XTEND_POOL_DEV_URL=postgres://<user>:<pass>@127.0.0.1:<port>/<db> pnpm --filter @xtend/pool dev
  curl -XPOST localhost:1337/register                                   # {"installId":"<id>"}
  curl -XPOST localhost:1337/push -H "x-install: <id>" -d '{"items":[{"post":{"postId":"1",
    "text":"hi","createdAt":"2026-01-01T00:00:00Z","author":{"userId":"2","handle":"a"}},
    "metrics":{"views":1,"likes":0,"reposts":0,"replies":0,"quotes":0,"bookmarks":0}}]}'  # 202
  curl "localhost:1337/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"        # flushes
  curl localhost:1337/trends/hot                                        # the pushed post
  ```

- Size: `select count(*) from pool_posts`, installs: `select count(*) from pool_installs`.
- Abuse: an install's pushes are in `pool_installs.pushes`; its rows in `pool_sightings`. Delete
  the install's sightings and metrics to remove its votes; content it was first to report stays.
