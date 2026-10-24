import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The Library's morning jobs (picks, hook detection, ready-to-post) make paid searches and
// model calls with nobody clicking, so they run only once the user turns them on.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN daily_library_jobs INTEGER NOT NULL DEFAULT 0`;
});
