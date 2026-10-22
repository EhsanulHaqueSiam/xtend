import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { runMigrations } from "./Migrations.ts";

const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // The desktop and a CLI may write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    // Every observation batch is its own commit; NORMAL only fsyncs at checkpoints and cannot corrupt the file.
    yield* sql`PRAGMA synchronous = NORMAL;`;
    yield* runMigrations();
  }),
);

const layerFromPath = Effect.fn("Sqlite.layerFromPath")(function* (dbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
  return Layer.provideMerge(layerSetup, SqliteClient.layer({ filename: dbPath }));
}, Layer.unwrap);

export const layerMemory = Layer.provideMerge(
  layerSetup,
  SqliteClient.layer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { dbPath } = yield* ServerConfig.ServerConfig;
    return layerFromPath(dbPath);
  }),
);
