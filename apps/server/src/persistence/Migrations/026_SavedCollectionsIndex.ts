import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// collection_posts is keyed (collection_id, saved_id), so looking a saved post's collections up
// by saved_id scanned the whole table once per saved row: the saved list took ~200 ms at 3.5k
// saved posts and grew with the square of history. Owned by the library area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX idx_collection_posts_saved ON collection_posts (saved_id)`;
});
