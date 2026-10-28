# Pool database and worker

The shared pool is the Neon project `xtend-pool` (Singapore), reached only through the
Cloudflare Worker `xtend-pool` (`apps/pool`) over Hyperdrive. The schema is
`apps/server/src/pool/schema.sql` and re-applies in place.

```sh
neon connection-string --project-id <id>          # from the Neon CLI, logged in to the org
psql "$XTEND_POOL_URL" -v ON_ERROR_STOP=1 -f apps/server/src/pool/schema.sql
```

Never put the connection string in the repo, the service or the desktop. It lives in the
Hyperdrive config (`wrangler hyperdrive list`) with query caching off: `pool_register` and
`pool_push` are selects with side effects, and a cached select would skip them.

## Worker

```sh
pnpm --filter @xtend/pool deploy        # wrangler, logged in to the account that owns it
pnpm --filter @xtend/pool dev           # local, against the real Hyperdrive config
```

| route                       | does                                                    |
| --------------------------- | ------------------------------------------------------- |
| `POST /register`            | an install id; 5 per minute per address                 |
| `POST /push` + `x-install`  | `{ items: [...] }` up to 500; 30 per minute per install |
| `GET /trends/hot?limit=`    | `pool_hot_posts`, cached a minute                       |
| `GET /trends/rising?limit=` | `pool_rising_terms`, cached a minute                    |
| `GET /health`               |                                                         |

A cron every ten minutes refreshes both views. Logs and errors are in Workers observability.

## Operating it

- `select pool_register()` and `select pool_push(<id>, '<batch json>')` are what the worker
  calls; run them by hand to test a schema change. `pool_push` returns the accepted count.
- Size: `select count(*) from pool_posts`, installs: `select count(*) from pool_installs`.
- Abuse: an install's pushes are in `pool_installs.pushes`; its rows in `pool_sightings`. Delete
  the install's sightings and metrics to remove its votes; content it was first to report stays.
