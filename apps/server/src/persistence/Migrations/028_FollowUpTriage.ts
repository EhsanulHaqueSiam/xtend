import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Follow-ups become triage: the reply keeps the post it answered, so the detail can show it and
// reply again in place, and a follow-up marked done or dismissed leaves the due list. Rows sent
// before this have no post. Owned by engage.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE replies_sent ADD COLUMN target_json TEXT`;
  yield* sql`ALTER TABLE replies_sent ADD COLUMN follow_up TEXT`;
});
