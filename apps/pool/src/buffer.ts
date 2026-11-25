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
    // Installs the pool turned away at a flush; their next push gets a 401 so they register again.
    sql.exec("create table if not exists forgotten (install text primary key)");
    sql.exec("create table if not exists snapshot (id integer primary key, json text not null)");
  }

  /** Queues one validated push body (`{ items: [...] }`), stamped with this clock. */
  add(install: string, body: string): "queued" | "unknown" | "full" {
    const sql = this.ctx.storage.sql;
    if (sql.exec("select 1 from forgotten where install = ?", install).toArray().length > 0)
      return "unknown";
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
        const [row] = await sql<
          { result: { accepted: number; failed: number; unknown: string[] } }[]
        >`
          select pool_flush(${entriesJson(rows)}::text::jsonb) as result`;
        const result = row!.result;
        for (const install of result.unknown)
          local.exec("insert or ignore into forgotten (install) values (?)", install);
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
      local.exec(
        "insert or replace into snapshot (id, json) values (1, ?)",
        JSON.stringify({ ...counts!, hot, rising } satisfies Snapshot),
      );
    } finally {
      await sql.end();
    }
  }
}
