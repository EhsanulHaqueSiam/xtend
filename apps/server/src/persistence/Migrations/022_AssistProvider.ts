import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Free first for assist: the user's own OpenAI-compatible endpoint (a local Ollama, their own
// key at a provider) answers model calls for nothing; null keeps the metered path.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN assist_base_url TEXT`;
  yield* sql`ALTER TABLE settings ADD COLUMN assist_model TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE settings ADD COLUMN assist_key TEXT`;
});
