import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Tables for the Analyze and Scores screens. Owned by the analyze area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The account's own timeline, replaced wholesale on each refresh.
  yield* sql`
    CREATE TABLE account_posts (
      post_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      url TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      views INTEGER,
      likes INTEGER NOT NULL,
      reposts INTEGER NOT NULL,
      replies INTEGER NOT NULL,
      quotes INTEGER NOT NULL,
      bookmarks INTEGER NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_account_posts_handle ON account_posts(handle, created_at DESC)`;

  // One row per day so growth charts are a range query.
  yield* sql`
    CREATE TABLE profile_snapshots (
      handle TEXT NOT NULL,
      day TEXT NOT NULL,
      followers INTEGER NOT NULL,
      following INTEGER NOT NULL,
      posts INTEGER NOT NULL,
      PRIMARY KEY (handle, day)
    )
  `;

  // Assist results and competitor fetches, keyed by what produced them.
  yield* sql`
    CREATE TABLE analysis_cache (
      cache_key TEXT PRIMARY KEY,
      body_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE score_samples (
      handle TEXT NOT NULL,
      day TEXT NOT NULL,
      at TEXT NOT NULL,
      score REAL NOT NULL,
      tier TEXT NOT NULL,
      followers INTEGER NOT NULL,
      sampled INTEGER NOT NULL,
      bot_share REAL NOT NULL,
      top_followers_json TEXT NOT NULL,
      bot_json TEXT NOT NULL,
      PRIMARY KEY (handle, day)
    )
  `;

  // Handles the user watches; shared by Scores watchlist and Analyze competitors.
  yield* sql`
    CREATE TABLE watch (
      handle TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    )
  `;
});
