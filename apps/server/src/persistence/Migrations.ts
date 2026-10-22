import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./Migrations/001_Observations.ts";
import Migration0002 from "./Migrations/002_Foundation.ts";
import Migration0003 from "./Migrations/003_Compose.ts";
import Migration0004 from "./Migrations/004_Analyze.ts";
import Migration0005 from "./Migrations/005_Library.ts";
import Migration0006 from "./Migrations/006_Leads.ts";

const migrationEntries = [
  [1, "Observations", Migration0001],
  [2, "Foundation", Migration0002],
  [3, "Compose", Migration0003],
  [4, "Analyze", Migration0004],
  [5, "Library", Migration0005],
  [6, "Leads", Migration0006],
] as const;

const run = Migrator.make({});

const loader = Migrator.fromRecord(
  Object.fromEntries(migrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration])),
);

export const runMigrations = Effect.fn("runMigrations")(function* () {
  const executed = yield* run({ loader });
  yield* executed.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran").pipe(
        Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
      );
});
