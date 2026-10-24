import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Incoming replies the Engage inbox already announced with mention_arrived, per account. Kept in
 * memory, they were announced again after every restart. Owned by the engage area.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE announced_mentions (
      account_id INTEGER NOT NULL,
      post_id TEXT NOT NULL,
      PRIMARY KEY (account_id, post_id)
    )
  `;
});
