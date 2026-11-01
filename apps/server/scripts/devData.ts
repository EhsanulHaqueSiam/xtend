// @effect-diagnostics nodeBuiltinImport:off -- dev scripts check files, paths and holders before the service ever runs.
// What makes a dev database safe to run: nothing in it acts on its own, spends, or reaches
// anyone, and it is never the user's live install. seed-dev.ts, copy-dev-db.ts and
// xtend-sqlite-state.ts share these.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The service's database inside a base dir. */
export const dbPathOf = (baseDir: string) => NodePath.join(baseDir, "xtend.sqlite");

const real = (dir: string) => {
  try {
    return NodeFS.realpathSync(dir);
  } catch {
    return NodePath.resolve(dir);
  }
};

/** Throws for the user's live install, ~/.xtend, or anything inside it. */
export const refuseLiveHome = (baseDir: string, home = NodeOS.homedir()) => {
  const live = real(NodePath.join(home, ".xtend"));
  const target = real(baseDir);
  if (target === live || target.startsWith(`${live}${NodePath.sep}`))
    throw new Error(`${baseDir} is the live install (~/.xtend); use a dev base dir.`);
};

/**
 * Throws while a process has `db` open: a running service would race the write. lsof reports
 * every holder, whatever port it serves; without lsof the check is skipped.
 */
export const refuseHeld = (db: string) => {
  if (!NodeFS.existsSync(db)) return;
  const holders = NodeChildProcess.spawnSync("lsof", ["-t", "--", db], { encoding: "utf8" });
  const pids = holders.stdout?.trim() ?? "";
  if (pids !== "")
    throw new Error(`${db} is open in process ${pids.split("\n").join(", ")}; stop it first.`);
};

/**
 * Turns off everything that would act, spend or reach someone in a dev database: rules and
 * agents, due undo actions, pending approvals, webhook backlog, paid nightly jobs, session
 * posting, pool sharing and the stored treg token. Queued drafts move at least a day out, and AI
 * assist points at the dev fake (`assistUrl`). Run after migrations, on the dev copy only.
 */
export const neutralize = Effect.fn("devData.neutralize")(function* (options: {
  readonly now: number;
  readonly assistUrl: string;
}) {
  const sql = yield* SqlClient.SqlClient;
  const cutoff = DateTime.formatIso(DateTime.makeUnsafe(options.now + 24 * 3_600_000));
  yield* sql`UPDATE rules SET enabled = 0, webhook_secret = lower(hex(randomblob(16)))`;
  yield* sql`UPDATE agents SET enabled = 0`;
  yield* sql`UPDATE drafts SET status = 'queued' WHERE status = 'posting'`;
  // Spread over three days past the cutoff, so the Plan screen still shows a queue.
  yield* sql`
    UPDATE drafts
    SET scheduled_at = strftime('%Y-%m-%dT%H:%M:%fZ', ${cutoff}, '+' || (rowid % 72) || ' hours')
    WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at < ${cutoff})`;
  yield* sql`UPDATE scheduled_actions SET status = 'failed' WHERE status = 'due'`;
  yield* sql`UPDATE pending_requests SET status = 'dismissed' WHERE status = 'pending'`;
  yield* sql`DELETE FROM webhook_events`;
  yield* sql`UPDATE post_analytics_nightly SET enabled = 0`;
  yield* sql`
    UPDATE settings SET
      treg_token = NULL,
      session_posting_enabled = 0,
      daily_library_jobs = 0,
      pool_sharing = 0,
      pool_install_id = NULL,
      assist_provider = 'endpoint',
      assist_base_url = ${options.assistUrl},
      assist_model = 'fake',
      assist_key = NULL`;
});
