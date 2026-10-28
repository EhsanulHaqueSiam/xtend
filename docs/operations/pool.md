# Pool database

The shared pool is the Neon project `xtend-pool` (Singapore). The schema is
`apps/server/src/pool/schema.sql` and re-applies in place.

```sh
neon connection-string --project-id <id>          # from the Neon CLI, logged in to the org
psql "$XTEND_POOL_URL" -v ON_ERROR_STOP=1 -f apps/server/src/pool/schema.sql
```

Never put the connection string in the repo, the service or the desktop. The worker holds it.

## Operating it

- `select pool_register()` issues an install id; `select pool_push(<id>, '<batch json>')`
  pushes one batch and returns how many items were accepted.
- `refresh materialized view concurrently pool_hot_posts` and `pool_rising_terms` every ten
  minutes from the worker's schedule; both have unique indexes so the refresh is concurrent.
- Size: `select count(*) from pool_posts`, installs: `select count(*) from pool_installs`.
- Abuse: an install's pushes are in `pool_installs.pushes`; its rows in `pool_sightings`. Delete
  the install's sightings and metrics to remove its votes; content it was first to report stays.
