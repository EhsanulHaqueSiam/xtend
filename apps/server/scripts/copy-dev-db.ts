// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- a dev CLI: argv, a file check and a usage line.
// A dev base dir with a copy of the user's real install, made safe: the database alone (never the
// auth token, the secret key or the Electron profile), pruned to recent metrics, then neutralized
// and stripped of secrets. `pnpm dev --seed real` runs it on a first start.

//   node apps/server/scripts/copy-dev-db.ts --base-dir .xtend [--source ~/.xtend] [--days 30]
//     [--assist-url http://127.0.0.1:7820]
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../src/persistence/Sqlite.ts";
import { dbPathOf, neutralize, refuseLiveHome } from "./devData.ts";

/**
 * Copies `source`'s database into `baseDir`, which must have none yet. The source is opened read
 * only and copied with VACUUM INTO, one consistent snapshot that includes rows still in its WAL,
 * so the live app may keep running. The copy is migrated, then pruned and neutralized.
 */
export const copyDevDb = Effect.fn("copyDevDb")(function* (options: {
  readonly baseDir: string;
  readonly source: string;
  readonly days: number;
  readonly assistUrl: string;
}) {
  refuseLiveHome(options.baseDir);
  const db = dbPathOf(options.baseDir);
  const from = dbPathOf(options.source);
  if (NodeFS.existsSync(db))
    return yield* Effect.die(new Error(`${db} exists; copy only into a fresh base dir.`));
  if (!NodeFS.existsSync(from)) return yield* Effect.die(new Error(`no database at ${from}`));
  NodeFS.mkdirSync(options.baseDir, { recursive: true });
  yield* Effect.flatMap(SqlClient.SqlClient, (sql) => sql`VACUUM INTO ${db}`).pipe(
    Effect.provide(SqliteClient.layer({ filename: from, readonly: true, disableWAL: true })),
  );
  const now = yield* Clock.currentTimeMillis;
  const cutoff = DateTime.formatIso(DateTime.makeUnsafe(now - options.days * 86_400_000));
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // Older metrics go, but every post keeps its latest row so it still renders.
    yield* sql`
      DELETE FROM post_metrics WHERE observed_at < ${cutoff}
        AND rowid NOT IN (SELECT max(rowid) FROM post_metrics GROUP BY post_id)`;
    yield* sql`DELETE FROM spend_log WHERE at < ${cutoff}`;
    yield* neutralize({ now, assistUrl: options.assistUrl });
  }).pipe(Effect.provide(Sqlite.layerFromPath(db).pipe(Layer.provide(NodeServices.layer))));
  return { db };
});

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      "base-dir": { type: "string" },
      source: { type: "string", default: NodePath.join(NodeOS.homedir(), ".xtend") },
      days: { type: "string", default: "30" },
      "assist-url": { type: "string", default: "http://127.0.0.1:7820" },
    },
  });
  const baseDir = values["base-dir"];
  const days = Number(values.days);
  if (baseDir === undefined || !Number.isInteger(days) || days < 1) {
    console.error("usage: copy-dev-db.ts --base-dir <dir> [--source <dir>] [--days 30]");
    process.exit(1);
  }
  NodeRuntime.runMain(
    copyDevDb({ baseDir, source: values.source, days, assistUrl: values["assist-url"] }).pipe(
      Effect.tap(({ db }) => Effect.log(`copied your install into ${db}, made safe for dev`)),
      Effect.provide(NodeServices.layer),
    ),
  );
}
