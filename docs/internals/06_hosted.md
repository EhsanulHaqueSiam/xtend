# Hosted web tier (design only)

Not built. Five days of work after everything else, and it needs a hosting decision first.
This note fixes the shape so the local service does not drift away from it.

## What it is

A multi-tenant deployment of the same service for people who do not run the desktop: the
suite screens (compose, plan, analyze, library, engage, leads, automate, scores) against the X
API through treg, plus public pages and teams. No session view, no observations, no
session posting, no overlay: everything that needs the user's own browser session stays
desktop-only, and the hosted UI hides those affordances behind one `capabilities` flag the
client already receives from `server.info`.

## Schema

The SQLite schema is the contract; Postgres carries the same tables through a Drizzle schema
generated from the migrations rather than written by hand:

- One Drizzle schema file per area, column for column the same names and types as the
  SQLite migrations (`TEXT` ISO timestamps become `timestamptz`, `INTEGER` booleans become
  `boolean`, JSON text columns become `jsonb`).
- `account_id` (migration 014) is already on every per-account table. Hosted adds
  `user_id` to `accounts` and nothing else: a row's tenant is `accounts.user_id` through
  `account_id`. The `(SELECT current_account_id FROM settings)` filter the stores use becomes
  a request-scoped `CurrentAccount` service that the Postgres `SqlClient` layer reads from the
  session (Clerk user plus the account picked in the UI). Stores are unchanged; only the
  SQL literal in `persistence/account.ts` is swapped for a parameter by the hosted layer.
- `settings` stops being a singleton: one row per account (`id` = `account_id`), keyed the
  same way the local row is keyed today once `CHECK (id = 1)` goes.
- Row-level security in Postgres on `account_id IN (accounts of current user)` as the
  backstop; the app sets `set_config('app.user_id', ...)` per transaction.
- Migrations run through `effect/sql/Migrator` against `@effect/sql-pg`, same loader, with
  the SQLite-only statements (`PRAGMA`, `ALTER TABLE ... ADD COLUMN` quirks, triggers) behind
  a dialect switch. The insert trigger from 014 is not needed: the request scope supplies
  `account_id` explicitly.

## Identity and money

- Clerk for sign-in and organisations. A Clerk user owns accounts; a Clerk organisation is a
  team.
- Per-user treg token: pasted once in Settings, encrypted with a per-user key derived from a
  KMS-held master key (the local `secret-key` file becomes a key per user). Every X call is
  billed to the user's own treg balance; the hosted service never carries a shared wallet.
- Budget stays per account, as now.

## Public pages

- `/@handle` stats page and `/c/<collection>` collection pages rendered server-side from
  the same stores with a `public` flag on `accounts` and `collections`. Read-only, cached, no
  Clerk needed to view.

## Teams

- Comments on drafts (`draft_comments`: draft_id, user_id, body, created_at) and an approval
  state on drafts (`approval`: `none | requested | approved | changes_requested`, plus
  `approved_by`). The scheduler refuses to post a draft whose account requires approval while
  it is not `approved`. That is one new column, one new table and one check in
  `Publisher`, nothing structural.

## Hosting decision needed

Where it runs decides the rest: a single Node process with Postgres (Railway, Fly) keeps the
scheduler and automation loops exactly as they are; a serverless target would need the
60-second engines moved to a queue. The treg token handling and Clerk setup are the same
either way. Nothing here starts before that call.
