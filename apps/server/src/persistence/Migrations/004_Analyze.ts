import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Tables for the  area and its paired screen. Owned by that area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`SELECT 1`;
});
