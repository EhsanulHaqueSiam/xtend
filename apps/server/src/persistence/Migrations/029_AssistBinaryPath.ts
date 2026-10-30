import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Assist runs the Claude or Codex CLI the way T3 Code does, so the user can name the command
// (an account-picking wrapper, a binary off PATH); empty finds it on the login shell's PATH.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE settings ADD COLUMN assist_binary_path TEXT NOT NULL DEFAULT ''`;
});
