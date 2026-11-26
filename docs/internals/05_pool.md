# The shared pool

Trends from one person's timeline are thin, and the treg trending call is paid. The pool is
one Postgres (Neon, project `xtend-pool`) where every install's public sightings land, so
Library Trends and Analyze Competitors can read what everyone's X is doing for free.

## What goes in, and what never does

Public posts, their authors and one metrics row per sighting. Promoted items and repost
wrappers are dropped. No viewer handle, no account, no DMs, no bookmarks, no lists. The only
per-install fact is a random install id, kept in its own tables for rate limiting and one vote
per install, and never joined to content in a query that serves trends.

Sharing is on by default with the exact list above in Settings; off stops the push and keeps
reading.

## Why a worker in front

The service never holds the pool's credentials: a connection string in a desktop app leaks.
A Cloudflare Worker (`infra/pool`) holds it through Hyperdrive, issues install ids
(`pool_register`) and rate limits per address and per install.

Neon's free plan bills compute by the minute it is awake, and it stays awake five minutes after
any query, so a database touched by every push is awake whenever anyone browses. Pushes
therefore queue in one Durable Object (`PoolBuffer`), stamped with the worker's clock, and the
hourly cron sends them in chunks to `pool_flush`, which calls `pool_push(install, batch, seen)`
per push. Trends are served from a snapshot the same run takes, so reads never wake Neon either.
The object queues only installs it knows: `/register` adds them, and an id it has not seen is
looked up in Neon once, so a forged id is still refused before it takes buffer space. An install
`pool_flush` reports unknown leaves the set, its next push gets a 401, and the service registers
again. A push Postgres cannot read fails its chunk; that chunk is resent one push at a time and
only the bad push is dropped, so it cannot block the queue. Hyperdrive's query cache is off for this
config: both functions are selects with side effects, and a cached select would skip them. The
schema is `apps/server/src/pool/schema.sql`; it re-applies in place.

## What the database defends on its own

Because the worker is the only client, the function is where the shared table protects itself:

- Sightings are stamped with the worker's clock when the push arrived; a client cannot move a
  post in time, and an hour in the buffer does not either.
- Ids, handles, text lengths and metric signs are checked per item; a bad item is skipped, not
  the batch; a batch is capped.
- An author's handle, name and verified flag freeze at first sight; only followers update.
- One metrics row per install per post per hour.
- Installs come only from `pool_register`, with an hourly cap far above honest load as a
  backstop.
- Trends count only posts three settled installs saw; an install is settled a day after it
  registered, so a burst of fresh ids cannot vote.

Known shortcut: post text and author identity are first-writer-wins. Per-install claims with a
majority text and median metrics are the next step once the worker exists.
