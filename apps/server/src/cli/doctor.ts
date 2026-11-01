import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient } from "effect/http";

import * as ServerConfig from "../config.ts";
import { migrationEntries } from "../persistence/Migrations.ts";

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DoctorInput {
  readonly baseDir: string;
  readonly dbPath: string;
  readonly serviceUrl: string;
  readonly version: string;
  /** PATH to look for the assist CLIs in; the login shell's, as the service sees it. */
  readonly pathEnv: string;
  /** The launchd agent's state, or undefined off macOS. */
  readonly launchd: { readonly installed: boolean; readonly loaded: boolean } | undefined;
  readonly homeDir: string;
}

const TRACE_STALE = Duration.days(1);
const LATEST_MIGRATION = Math.max(...migrationEntries.map(([id]) => id));
const decodeHealth = Schema.decodeUnknownEffect(
  Schema.Struct({ name: Schema.String, version: Schema.String }),
);
const decodeTregCli = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ token: Schema.NonEmptyString })),
);

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail });
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail });

const ago = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};

// Read-only, so it is safe beside a running service: WAL lets a reader in while it writes.
const readDatabase = Effect.fn("Doctor.readDatabase")(function* (dbPath: string) {
  const read = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const migrated = yield* sql<{ id: number | null }>`
      SELECT MAX(migration_id) AS id FROM effect_sql_migrations
    `;
    const settings = yield* sql<{ token_set: number }>`
      SELECT treg_token IS NOT NULL AS token_set FROM settings WHERE id = 1
    `.pipe(Effect.orElseSucceed(() => []));
    return { migration: migrated[0]?.id ?? 0, tregTokenSet: settings[0]?.token_set === 1 };
  });
  return yield* read.pipe(Effect.provide(SqliteClient.layer({ filename: dbPath, readonly: true })));
});

/**
 * Health checks for a base dir and the service using it. Nothing here writes, starts a service,
 * reaches X or spends: the database opens read-only and the service is asked only for /api/health.
 */
export const runDoctor = Effect.fn("cli.doctor")(function* (input: DoctorInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const now = yield* Clock.currentTimeMillis;
  const checks: Array<Check> = [];

  checks.push(
    yield* fs.access(input.baseDir, { writable: true }).pipe(
      Effect.as(pass("base dir", `${input.baseDir} is writable`)),
      Effect.orElseSucceed(() =>
        fail("base dir", `${input.baseDir} is missing or not writable; the service creates it`),
      ),
    ),
  );

  const db = (yield* fs.exists(input.dbPath).pipe(Effect.orElseSucceed(() => false)))
    ? yield* readDatabase(input.dbPath).pipe(Effect.option)
    : undefined;
  checks.push(
    db === undefined
      ? fail("database", `no database at ${input.dbPath}; the service creates it on first start`)
      : db._tag === "None"
        ? fail("database", `${input.dbPath} does not open read-only`)
        : db.value.migration === LATEST_MIGRATION
          ? pass("database", `migrated to ${LATEST_MIGRATION}`)
          : db.value.migration < LATEST_MIGRATION
            ? fail(
                "database",
                `at migration ${db.value.migration} of ${LATEST_MIGRATION}; the service migrates it on start`,
              )
            : fail(
                "database",
                `at migration ${db.value.migration}, newer than this build (${LATEST_MIGRATION})`,
              ),
  );

  checks.push(
    yield* http.get(`${input.serviceUrl}/api/health`).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(decodeHealth),
      Effect.timeout(Duration.seconds(2)),
      Effect.map((health) =>
        pass(
          "service",
          `${health.name} ${health.version} at ${input.serviceUrl}${health.version === input.version ? "" : ` (this CLI is ${input.version})`}`,
        ),
      ),
      Effect.orElseSucceed(() => fail("service", `nothing answers at ${input.serviceUrl}`)),
    ),
  );

  const trace = yield* ServerConfig.observability(input.baseDir);
  const traceStat = yield* fs.stat(trace.traceFile).pipe(Effect.option);
  const traceAge =
    traceStat._tag === "Some" && traceStat.value.mtime._tag === "Some"
      ? now - traceStat.value.mtime.value.getTime()
      : undefined;
  checks.push(
    !trace.traceEnabled
      ? pass("trace file", "turned off by XTEND_TRACE_DISABLED")
      : traceAge === undefined
        ? fail("trace file", `none at ${trace.traceFile}; the service writes it while it runs`)
        : traceAge > Duration.toMillis(TRACE_STALE)
          ? fail("trace file", `${trace.traceFile} last written ${ago(traceAge)}`)
          : pass("trace file", `${trace.traceFile} written ${ago(traceAge)}`),
  );

  // Same order Treg looks in; only where it is found is printed, never the token.
  const tregCli = yield* fs.readFileString(path.join(input.homeDir, ".treg", "config.json")).pipe(
    Effect.flatMap(decodeTregCli),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  const tokenSource =
    db?._tag === "Some" && db.value.tregTokenSet
      ? "Settings"
      : (process.env.XTEND_TREG_TOKEN ?? "") !== ""
        ? "XTEND_TREG_TOKEN"
        : tregCli
          ? "~/.treg/config.json"
          : undefined;
  checks.push(
    tokenSource === undefined
      ? fail("treg token", "none in Settings, XTEND_TREG_TOKEN or ~/.treg/config.json")
      : pass("treg token", `set in ${tokenSource}`),
  );

  const found = yield* Effect.forEach(["claude", "codex"], (binary) =>
    Effect.findFirst(
      input.pathEnv.split(":").filter((dir) => dir !== ""),
      (dir) => fs.exists(path.join(dir, binary)).pipe(Effect.orElseSucceed(() => false)),
    ).pipe(Effect.map((dir) => (dir._tag === "Some" ? path.join(dir.value, binary) : undefined))),
  );
  const [claude, codex] = found;
  checks.push(
    claude === undefined && codex === undefined
      ? fail("assist cli", "neither claude nor codex is on the login shell's PATH")
      : pass("assist cli", `claude ${claude ?? "not found"}, codex ${codex ?? "not found"}`),
  );

  if (input.launchd !== undefined)
    checks.push(
      !input.launchd.installed
        ? pass("launchd", "not installed; the desktop runs the service")
        : input.launchd.loaded
          ? pass("launchd", "installed and loaded")
          : fail("launchd", "installed but not loaded; run `xtend service install` again"),
    );

  return checks;
});

export const formatChecks = (checks: ReadonlyArray<Check>) => {
  const width = Math.max(...checks.map((c) => c.name.length));
  return checks
    .map((c) => `${c.ok ? "pass" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`)
    .join("\n");
};
