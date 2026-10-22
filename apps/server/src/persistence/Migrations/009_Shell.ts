import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Round 2 tables for the Shell work. Owned by that agent.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`SELECT 1`;
});
