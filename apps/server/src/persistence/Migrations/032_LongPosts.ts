import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Whether X lets the current account write longer posts (Premium), as X's composer last showed it.
// NULL until the desktop has seen it. Owned by compose.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN long_posts INTEGER`;
});
