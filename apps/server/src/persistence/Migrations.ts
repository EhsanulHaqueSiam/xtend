import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./Migrations/001_Observations.ts";
import Migration0002 from "./Migrations/002_Foundation.ts";
import Migration0003 from "./Migrations/003_Compose.ts";
import Migration0004 from "./Migrations/004_Analyze.ts";
import Migration0005 from "./Migrations/005_Library.ts";
import Migration0006 from "./Migrations/006_Leads.ts";
import Migration0007 from "./Migrations/007_Hardening.ts";
import Migration0008 from "./Migrations/008_Desktop.ts";
import Migration0009 from "./Migrations/009_Shell.ts";
import Migration0010 from "./Migrations/010_Posting.ts";
import Migration0011 from "./Migrations/011_Intelligence.ts";
import Migration0012 from "./Migrations/012_LibraryEngage.ts";
import Migration0013 from "./Migrations/013_LeadsAutomate.ts";
import Migration0014 from "./Migrations/014_Accounts.ts";
import Migration0015 from "./Migrations/015_AccountKeys.ts";
import Migration0016 from "./Migrations/016_LeadsPerAccount.ts";
import Migration0017 from "./Migrations/017_ObservationAccounts.ts";
import Migration0018 from "./Migrations/018_AnalyzeEngageAccounts.ts";
import Migration0019 from "./Migrations/019_AnnouncedMentions.ts";
import Migration0020 from "./Migrations/020_DailyJobs.ts";
import Migration0021 from "./Migrations/021_SessionActions.ts";
import Migration0022 from "./Migrations/022_AssistProvider.ts";
import Migration0023 from "./Migrations/023_PoolSharing.ts";
import Migration0024 from "./Migrations/024_AssistLogins.ts";
import Migration0025 from "./Migrations/025_PrivateMetricsOptIn.ts";
import Migration0026 from "./Migrations/026_SavedCollectionsIndex.ts";
import Migration0027 from "./Migrations/027_PrivateMetricsNightly.ts";
import Migration0028 from "./Migrations/028_FollowUpTriage.ts";

export const migrationEntries = [
  [1, "Observations", Migration0001],
  [2, "Foundation", Migration0002],
  [3, "Compose", Migration0003],
  [4, "Analyze", Migration0004],
  [5, "Library", Migration0005],
  [6, "Leads", Migration0006],
  [7, "Hardening", Migration0007],
  [8, "Desktop", Migration0008],
  [9, "Shell", Migration0009],
  [10, "Posting", Migration0010],
  [11, "Intelligence", Migration0011],
  [12, "LibraryEngage", Migration0012],
  [13, "LeadsAutomate", Migration0013],
  [14, "Accounts", Migration0014],
  [15, "AccountKeys", Migration0015],
  [16, "LeadsPerAccount", Migration0016],
  [17, "ObservationAccounts", Migration0017],
  [18, "AnalyzeEngageAccounts", Migration0018],
  [19, "AnnouncedMentions", Migration0019],
  [20, "DailyJobs", Migration0020],
  [21, "SessionActions", Migration0021],
  [22, "AssistProvider", Migration0022],
  [23, "PoolSharing", Migration0023],
  [24, "AssistLogins", Migration0024],
  [25, "PrivateMetricsOptIn", Migration0025],
  [26, "SavedCollectionsIndex", Migration0026],
  [27, "PrivateMetricsNightly", Migration0027],
  [28, "FollowUpTriage", Migration0028],
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
