// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- a dev CLI: argv, files and printed rows.
// Reads or edits a dev base dir's database for UI fixtures. One statement per call. `query` opens
// it read only and prints JSON rows; `exec` refuses the live install and a database a process
// holds open, backs it up first, and runs the statement in a transaction.

//   node apps/server/scripts/xtend-sqlite-state.ts query --base-dir .xtend --sql "SELECT ..."
//   node apps/server/scripts/xtend-sqlite-state.ts exec --base-dir .xtend --file seed.sql
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { dbPathOf, refuseHeld, refuseLiveHome } from "./devData.ts";

/** The rows `statement` returns, from a read-only connection. */
export const query = Effect.fn("sqliteState.query")(function* (baseDir: string, statement: string) {
  const db = dbPathOf(baseDir);
  if (!NodeFS.existsSync(db)) return yield* Effect.die(new Error(`no database at ${db}`));
  return yield* Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement)).pipe(
    Effect.provide(SqliteClient.layer({ filename: db, readonly: true, disableWAL: true })),
  );
});

/** Runs `statement` in a transaction after a full backup beside the database; returns its path. */
export const exec = Effect.fn("sqliteState.exec")(function* (baseDir: string, statement: string) {
  refuseLiveHome(baseDir);
  const db = dbPathOf(baseDir);
  if (!NodeFS.existsSync(db)) return yield* Effect.die(new Error(`no database at ${db}`));
  refuseHeld(db);
  const stamp = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
  const backup = `${db}.backup-${stamp.replace(/[:.]/g, "-")}`;
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`VACUUM INTO ${backup}`;
    NodeFS.chmodSync(backup, 0o600);
    yield* sql.withTransaction(sql.unsafe(statement));
  }).pipe(Effect.provide(SqliteClient.layer({ filename: db })));
  return backup;
});

if (import.meta.main) {
  const { positionals, values } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      "base-dir": { type: "string" },
      sql: { type: "string" },
      file: { type: "string" },
    },
  });
  const [verb] = positionals;
  const baseDir = values["base-dir"];
  const statement =
    values.sql ??
    (values.file === undefined ? undefined : NodeFS.readFileSync(values.file, "utf8"));
  if ((verb !== "query" && verb !== "exec") || baseDir === undefined || statement === undefined) {
    console.error(
      "usage: xtend-sqlite-state.ts query|exec --base-dir <dir> --sql <sql>|--file <f>",
    );
    process.exit(1);
  }
  NodeRuntime.runMain(
    (verb === "query"
      ? Effect.map(query(baseDir, statement), (rows) => console.log(JSON.stringify(rows, null, 2)))
      : Effect.map(exec(baseDir, statement), (backup) => console.log(`backup: ${backup}`))
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}
