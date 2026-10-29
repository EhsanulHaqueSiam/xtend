import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Assist runs on the logins already on the machine (Claude by default, or Codex), as T3 Code
// does; an install that had picked its own endpoint keeps it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN assist_provider TEXT NOT NULL DEFAULT 'claude'`;
  yield* sql`UPDATE settings SET assist_provider = 'endpoint' WHERE assist_base_url IS NOT NULL`;
});
