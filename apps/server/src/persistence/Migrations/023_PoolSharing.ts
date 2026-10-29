import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The shared pool: sharing is on by default (the exact list of what leaves is in Settings), and
// the install id the worker issued is the only thing the pool knows this install by.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN pool_sharing INTEGER NOT NULL DEFAULT 1`;
  yield* sql`ALTER TABLE settings ADD COLUMN pool_install_id TEXT`;
});
