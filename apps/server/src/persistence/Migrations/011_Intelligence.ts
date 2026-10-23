import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Phase 3 intelligence: X's private per-post metrics, the follower set behind
// each score sample, and the profile fields a handle history needs.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per own post per fetch day, so follows and impressions can be charted over time.
  yield* sql`
    CREATE TABLE post_analytics (
      post_id TEXT NOT NULL,
      day TEXT NOT NULL,
      impressions INTEGER NOT NULL,
      profile_visits INTEGER NOT NULL,
      link_clicks INTEGER NOT NULL,
      follows INTEGER NOT NULL,
      likes INTEGER NOT NULL,
      replies INTEGER NOT NULL,
      reposts INTEGER NOT NULL,
      PRIMARY KEY (post_id, day)
    )
  `;
  // Every run of the nightly job, failed ones included, so the UI can say why there is no data.
  yield* sql`
    CREATE TABLE post_analytics_runs (
      at TEXT PRIMARY KEY,
      posts INTEGER NOT NULL,
      error TEXT
    )
  `;

  // The scored followers of each sample; "who moved your score" diffs two of these.
  yield* sql`
    CREATE TABLE score_sample_followers (
      handle TEXT NOT NULL,
      day TEXT NOT NULL,
      user_id TEXT NOT NULL,
      follower_json TEXT NOT NULL,
      points REAL NOT NULL,
      PRIMARY KEY (handle, day, user_id)
    )
  `;
  yield* sql`ALTER TABLE score_samples ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'`;

  yield* sql`ALTER TABLE profile_snapshots ADD COLUMN name TEXT`;
  yield* sql`ALTER TABLE profile_snapshots ADD COLUMN bio TEXT`;
  yield* sql`ALTER TABLE profile_snapshots ADD COLUMN avatar_url TEXT`;
});
