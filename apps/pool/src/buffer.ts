import { DurableObject } from "cloudflare:workers";
import postgres from "postgres";

import { chunkEnd, entriesJson, type Pending } from "./flush.ts";

export interface Env {
  readonly POOL: Hyperdrive;
  readonly BUFFER: DurableObjectNamespace<PoolBuffer>;
  readonly REGISTER: RateLimit;
  readonly PUSH: RateLimit;
  readonly PUSH_ADDRESS: RateLimit;
}

/** Past this the buffer refuses pushes until a flush drains it (Neon down or out of compute). */
const MAX_BUFFER_BYTES = 200_000_000;
/** Rows a trends answer can ask for; the snapshot keeps this many of each. */
export const TRENDS_LIMIT = 100;

/** What trends are answered from; rows are as the views return them. */
type Row = Record<string, string | number | null>;
type Snapshot = { posts: number; installs: number; hot: Row[]; rising: Row[] };

type FlushResult = { accepted: number; failed: number; unknown: string[] };

/** A storage value holds 2 MB; at up to 3 UTF-8 bytes a character this stays under it. */
const MAX_SNAPSHOT_CHARS = 600_000;

/** Postgres refused the data itself (class 22, or 54 for nesting too deep), not the connection. */
const isDataError = (error: unknown) =>
  error instanceof postgres.PostgresError && /^(22|54)/.test(error.code);

/** One connection per use; Hyperdrive pools behind it. */
export const db = (env: Env) =>
  postgres(env.POOL.connectionString, { max: 1, prepare: false, fetch_types: false });

/**
 * Neon bills compute by the minute it is awake, so nothing a user does touches it directly:
 * pushes wait here and the hourly cron flushes them in one go, and trends are served from the
 * snapshot taken after that flush. One instance, named "pool", holds everything.
 */
export class PoolBuffer extends DurableObject<Env> {
  private bytes: number | undefined;
  private running: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`create table if not exists pushes (
      id integer primary key, install text not null, at text not null,
      body text not null, bytes integer not null)`);
    // Installs Neon confirmed. Anything else is checked there before it may queue, so a forged id
    // is refused up front; one the pool forgets at a flush leaves and must register again.
    sql.exec("create table if not exists known (install text primary key)");
    sql.exec("create table if not exists snapshot (id integer primary key, json text not null)");
  }

  /**
   * Queues one validated push body (`{ items: [...] }`), stamped with this clock. `registered`
   * says the caller just confirmed the install in Neon; without it an install not yet known is
   * "unchecked" and nothing is queued.
   */
  add(install: string, body: string, registered = false): "queued" | "unchecked" | "full" {
    const sql = this.ctx.storage.sql;
    if (registered) this.know(install);
    else if (sql.exec("select 1 from known where install = ?", install).toArray().length === 0)
      return "unchecked";
    this.bytes ??= sql
      .exec<{ n: number }>("select coalesce(sum(bytes), 0) as n from pushes")
      .one().n;
    if (this.bytes + body.length > MAX_BUFFER_BYTES) return "full";
    sql.exec(
      "insert into pushes (install, at, body, bytes) values (?, ?, ?, ?)",
      install,
      new Date().toISOString(),
      body,
      body.length,
    );
    this.bytes += body.length;
    return "queued";
  }

  know(install: string) {
    this.ctx.storage.sql.exec("insert or ignore into known (install) values (?)", install);
  }

  /** The last snapshot, taken now if there is none yet. */
  async trends(): Promise<Snapshot> {
    const read = () =>
      this.ctx.storage.sql
        .exec<{ json: string }>("select json from snapshot where id = 1")
        .toArray()[0]?.json;
    if (read() === undefined) await this.flush(true);
    const json = read();
    return json === undefined
      ? { posts: 0, installs: 0, hot: [], rising: [] }
      : (JSON.parse(json) as Snapshot);
  }

  /** Writes the buffer to Neon and takes a new snapshot. An idle hour never wakes Neon. */
  flush(force = false): Promise<void> {
    this.running ??= this.run(force).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(force: boolean) {
    const local = this.ctx.storage.sql;
    const next = () =>
      local
        .exec<{ id: number; bytes: number }>("select id, bytes from pushes order by id limit 1000")
        .toArray();
    let head = next();
    if (head.length === 0 && !force) return;
    const sql = db(this.env);
    try {
      while (head.length > 0) {
        const last = chunkEnd(head);
        const rows = local
          .exec<Pending>("select install, at, body from pushes where id <= ? order by id", last)
          .toArray();
        // Through text: a jsonb parameter would be JSON-encoded again by postgres.js.
        const send = async (chunk: ReadonlyArray<Pending>) => {
          const [row] = await sql<{ result: FlushResult }[]>`
            select pool_flush(${entriesJson(chunk)}::text::jsonb) as result`;
          return row!.result;
        };
        let result: FlushResult;
        try {
          result = await send(rows);
        } catch (error) {
          if (!isDataError(error)) throw error;
          // JSON that Postgres refuses (a \u0000, a number past numeric) fails the whole chunk:
          // send it again one push at a time and drop only the one it refuses.
          result = { accepted: 0, failed: 0, unknown: [] };
          for (const one of rows) {
            const r = await send([one]).catch((e: unknown) => {
              if (!isDataError(e)) throw e;
              return { accepted: 0, failed: 1, unknown: [] };
            });
            result = {
              accepted: result.accepted + r.accepted,
              failed: result.failed + r.failed,
              unknown: [...result.unknown, ...r.unknown],
            };
          }
        }
        for (const install of result.unknown)
          local.exec("delete from known where install = ?", install);
        local.exec("delete from pushes where id <= ?", last);
        this.bytes = undefined;
        if (result.failed > 0) console.warn("pool flush dropped pushes", result);
        head = next();
      }
      await sql`refresh materialized view concurrently pool_hot_posts`;
      await sql`refresh materialized view concurrently pool_rising_terms`;
      // Long posts are cut so a snapshot stays inside one storage value. bigint and numeric
      // arrive from postgres.js as strings; the service reads numbers.
      const hot = await sql`select post_id, handle, left(text, 4000) as text, created_at, sightings,
                                   views_24h::float8 as views_24h, likes_24h::float8 as likes_24h,
                                   reposts_24h::float8 as reposts_24h
                            from pool_hot_posts limit ${TRENDS_LIMIT}`;
      const rising = await sql`select word, today::float8 as today,
                                      per_day_before::float8 as per_day_before, lift::float8 as lift
                               from pool_rising_terms limit ${TRENDS_LIMIT}`;
      const [counts] = await sql<{ posts: number; installs: number }[]>`
        select (select count(*) from pool_posts)::int as posts,
               (select count(*) from pool_installs)::int as installs`;
      // Escaped text can outgrow the cut: drop the coldest hot posts until it fits.
      const snapshot = (): string => JSON.stringify({ ...counts!, hot, rising } satisfies Snapshot);
      let json = snapshot();
      while (json.length > MAX_SNAPSHOT_CHARS && hot.length > 0) {
        hot.pop();
        json = snapshot();
      }
      local.exec("insert or replace into snapshot (id, json) values (1, ?)", json);
    } finally {
      await sql.end();
    }
  }
}
