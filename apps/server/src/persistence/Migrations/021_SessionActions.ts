import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Free first: what the user clicks goes through their own session unless they turn it off.
// Rules and schedules never take that lane, so the default is safe to flip on.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`UPDATE settings SET session_posting_enabled = 1`;
});
