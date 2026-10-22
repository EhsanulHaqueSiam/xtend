import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./Migrations/001_Observations.ts";

const migrationEntries = [[1, "Observations", Migration0001]] as const;

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
