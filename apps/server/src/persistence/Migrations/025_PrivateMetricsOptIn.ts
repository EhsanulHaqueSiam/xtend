import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The nightly private-metrics read is paid, so it runs only once the user clicked the priced Fetch
// now. Runs the old nightly loop made on its own stay 0 and opt nobody in. Owned by analyze.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE post_analytics_runs ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`;
});
