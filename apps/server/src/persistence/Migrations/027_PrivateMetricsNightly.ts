import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The nightly private-metrics read becomes a per-account switch the user can turn off. No row
// means the user never fetched; the first Fetch now inserts it on. Accounts that already opted
// in with a manual run stay on. Owned by analyze.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE post_analytics_nightly (
      account_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO post_analytics_nightly (account_id, enabled)
    SELECT DISTINCT account_id, 1 FROM post_analytics_runs WHERE manual = 1
  `;
});
