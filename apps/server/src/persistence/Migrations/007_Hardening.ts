import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Phase 0 hardening: time zone, observation flags, draft source, score pages,
// suggested drafts folded into drafts, and every stored handle lowercased.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE settings ADD COLUMN time_zone TEXT`;
  yield* sql`ALTER TABLE observed_posts ADD COLUMN is_repost INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE observed_posts ADD COLUMN is_promoted INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE drafts ADD COLUMN source TEXT`;
  yield* sql`ALTER TABLE score_samples ADD COLUMN pages INTEGER NOT NULL DEFAULT 0`;
  // Library now writes real drafts with status 'suggested'.
  yield* sql`DROP TABLE suggested_drafts`;
  // Mentions X's API returned, so a refresh asks only for newer ones and a tab open costs nothing.
  yield* sql`
    CREATE TABLE api_mentions (
      post_id TEXT PRIMARY KEY,
      post_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `;

  // Handles compare case-insensitively on X; one spelling in every table.
  yield* sql`UPDATE settings SET handle = lower(handle) WHERE handle IS NOT NULL`;
  yield* sql`UPDATE observed_authors SET handle = lower(handle)`;
  yield* sql`UPDATE post_metrics SET viewer_handle = lower(viewer_handle) WHERE viewer_handle IS NOT NULL`;
  yield* sql`UPDATE account_posts SET handle = lower(handle)`;
  yield* sql`UPDATE people SET handle = lower(handle)`;
  yield* sql`UPDATE followers_seen SET handle = lower(handle)`;
  yield* sql`UPDATE replies_sent SET target_handle = lower(target_handle)`;
  // Keyed tables: a row that would collide with an already lowercase twin is dropped.
  yield* sql`UPDATE OR IGNORE profile_snapshots SET handle = lower(handle)`;
  yield* sql`DELETE FROM profile_snapshots WHERE handle <> lower(handle)`;
  yield* sql`UPDATE OR IGNORE score_samples SET handle = lower(handle)`;
  yield* sql`DELETE FROM score_samples WHERE handle <> lower(handle)`;
  yield* sql`UPDATE OR IGNORE watch SET handle = lower(handle)`;
  yield* sql`DELETE FROM watch WHERE handle <> lower(handle)`;
});
