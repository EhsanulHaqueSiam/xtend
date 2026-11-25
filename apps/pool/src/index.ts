import { isInstallId, MAX_BODY_BYTES, readBatch } from "./batch.ts";
import { db, type Env, TRENDS_LIMIT } from "./buffer.ts";

export { PoolBuffer } from "./buffer.ts";

/**
 * The only client of the shared pool. The service pushes what its session saw
 * and reads trends; this worker holds the database, issues install ids and
 * limits each caller. Pushes queue in the PoolBuffer object and reach Neon on
 * the hourly flush, where `pool_push` checks every item again.
 */

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

// The snapshot changes once an hour.
const TRENDS_CACHE = "public, max-age=300";

const buffer = (env: Env) => env.BUFFER.getByName("pool");

const registered = async (env: Env, install: string) => {
  const sql = db(env);
  try {
    const [row] = await sql<{ known: boolean }[]>`
      select exists (select 1 from pool_installs where install_id = ${install}::uuid) as known`;
    return row!.known;
  } finally {
    await sql.end();
  }
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

  if (request.method === "POST" && url.pathname === "/register") {
    const { success } = await env.REGISTER.limit({ key: ip });
    if (!success) return json({ error: "too many registrations" }, 429);
    const sql = db(env);
    try {
      const [row] = await sql<{ pool_register: string }[]>`select pool_register()`;
      await buffer(env).know(row!.pool_register);
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
    const pool = buffer(env);
    // The cleaned items are what queue, never the raw body.
    const clean = JSON.stringify({ items: batch.items });
    let queued = await pool.add(install, clean);
    // First push from an install the buffer has not seen: Neon says whether it exists, once.
    if (queued === "unchecked" && (await registered(env, install)))
      queued = await pool.add(install, clean, true);
    if (queued === "unchecked") return json({ error: "unknown install" }, 401);
    if (queued === "full") return json({ error: "pool is catching up" }, 503);
    return json({ queued: batch.items.length }, 202);
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/trends/hot" || url.pathname === "/trends/rising")
  ) {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), TRENDS_LIMIT);
    const snapshot = await buffer(env).trends();
    const rows = url.pathname === "/trends/hot" ? snapshot.hot : snapshot.rising;
    return json(
      { posts: snapshot.posts, installs: snapshot.installs, rows: rows.slice(0, limit) },
      200,
      { "cache-control": TRENDS_CACHE },
    );
  }

  if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
  return json({ error: "not found" }, 404);
}

export default {
  // An unexpected failure surfaces as the platform's own error and lands in observability.
  fetch: (request: Request, env: Env) => handle(request, env),
  /** Hourly: the buffered pushes into Neon, then fresh trend views and snapshot. */
  scheduled: (_controller: ScheduledController, env: Env) => buffer(env).flush(),
} satisfies ExportedHandler<Env>;
