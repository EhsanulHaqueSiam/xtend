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
Hyperdrive config (`wrangler hyperdrive list`) with query caching off: `pool_register` and
`pool_flush` are selects with side effects, and a cached select would skip them.

## Worker

```sh
pnpm --filter @xtend/pool deploy        # wrangler, logged in to the account that owns it
pnpm --filter @xtend/pool dev           # local, against the real Hyperdrive config
```

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
- Local run: `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POOL=<local postgres> pnpm --filter
  @xtend/pool dev --test-scheduled`, then `curl localhost:8787/cdn-cgi/handler/scheduled` flushes.
- Size: `select count(*) from pool_posts`, installs: `select count(*) from pool_installs`.
- Abuse: an install's pushes are in `pool_installs.pushes`; its rows in `pool_sightings`. Delete
  the install's sightings and metrics to remove its votes; content it was first to report stays.
