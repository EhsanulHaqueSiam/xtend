import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * observed_posts is one row per post, stamped with the first account that saw it, so a post
 * both accounts' timelines carry never showed in the second account's Home. Each sighting
 * (a post_metrics row) now names the account it was captured under, and Home lists the posts
 * the current account saw. Owned by the platform agent.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE post_metrics ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1`;
  yield* sql`
    UPDATE post_metrics SET account_id = COALESCE(
      (SELECT account_id FROM observed_posts WHERE observed_posts.post_id = post_metrics.post_id),
      1
    )
  `;
});
