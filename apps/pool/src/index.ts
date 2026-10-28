import postgres, { type JSONValue } from "postgres";

import { isInstallId, MAX_BODY_BYTES, readBatch } from "./batch.ts";

/**
 * The only client of the shared pool. The service pushes what its session saw
 * and reads trends; this worker holds the database, issues install ids and
 * limits each caller. Everything it accepts is checked again by `pool_push`.
 */
interface Env {
  readonly POOL: Hyperdrive;
  readonly REGISTER: RateLimit;
  readonly PUSH: RateLimit;
  readonly PUSH_ADDRESS: RateLimit;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const TRENDS_CACHE = "public, max-age=60";

/** One connection per request; Hyperdrive pools behind it. */
const db = (env: Env) =>
  postgres(env.POOL.connectionString, { max: 1, prepare: false, fetch_types: false });

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  if (request.method === "POST" && url.pathname === "/register") {
    const { success } = await env.REGISTER.limit({ key: ip });
    if (!success) return json({ error: "too many registrations" }, 429);
    const sql = db(env);
    try {
      const [row] = await sql<{ pool_register: string }[]>`select pool_register()`;
      return json({ installId: row!.pool_register });
    } finally {
      await sql.end();
    }
  }

  if (request.method === "POST" && url.pathname === "/push") {
    const header = request.headers.get("x-install");
    if (!isInstallId(header)) return json({ error: "x-install must be an install id" }, 401);
    const install: string = header;
    // Per address first, so a forged install id costs the sender its own budget, then per install.
    const byAddress = await env.PUSH_ADDRESS.limit({ key: ip });
    if (!byAddress.success) return json({ error: "too many pushes" }, 429);
    const { success } = await env.PUSH.limit({ key: install });
    if (!success) return json({ error: "too many pushes" }, 429);
    // The body is read whole and measured; a missing length is refused rather than trusted.
    const length = Number(request.headers.get("content-length"));
    if (!Number.isFinite(length) || length <= 0)
      return json({ error: "content-length required" }, 411);
    if (length > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return json({ error: "body too large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const batch = readBatch(body);
    if ("error" in batch) return json(batch, 400);
    const sql = db(env);
    try {
      const [row] = await sql<{ pool_push: number }[]>`
        select pool_push(${install}::uuid, ${sql.json(batch.items as JSONValue)})`;
      return json({ accepted: row!.pool_push });
    } catch (error) {
      // Only the function's own refusals reach the caller; anything else stays in the logs.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("unknown install")) return json({ error: "unknown install" }, 401);
      if (message.includes("batch too large")) return json({ error: "batch too large" }, 413);
      console.warn(message);
      return json({ error: "batch refused" }, 500);
    } finally {
      await sql.end();
    }
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/trends/hot" || url.pathname === "/trends/rising")
  ) {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
    const sql = db(env);
    try {
      const rows =
        url.pathname === "/trends/hot"
          ? await sql`select post_id, handle, text, created_at, sightings, views_24h, likes_24h, reposts_24h
                      from pool_hot_posts limit ${limit}`
          : await sql`select word, today, per_day_before, lift from pool_rising_terms limit ${limit}`;
      const [meta] = await sql<{ posts: number; installs: number }[]>`
        select (select count(*) from pool_posts)::int as posts,
               (select count(*) from pool_installs)::int as installs`;
      return json({ ...meta, rows }, 200, { "cache-control": TRENDS_CACHE });
    } finally {
      await sql.end();
    }
  }

  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
  return json({ error: "not found" }, 404);
}

export default {
  // An unexpected failure surfaces as the platform's own error and lands in observability.
  fetch: (request: Request, env: Env) => handle(request, env),
  /** Every ten minutes: the two trend views, concurrently so reads keep working. */
  scheduled: async (_controller: ScheduledController, env: Env) => {
    const sql = db(env);
    try {
      await sql`refresh materialized view concurrently pool_hot_posts`;
      await sql`refresh materialized view concurrently pool_rising_terms`;
    } finally {
      await sql.end();
    }
  },
} satisfies ExportedHandler<Env>;
