import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE observed_authors (
      user_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      followers INTEGER,
      verified INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_observed_authors_handle ON observed_authors(handle)`;

  yield* sql`
    CREATE TABLE observed_posts (
      post_id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES observed_authors(user_id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_reply INTEGER NOT NULL DEFAULT 0,
      has_media INTEGER NOT NULL DEFAULT 0,
      has_link INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      observations INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX idx_observed_posts_last_seen ON observed_posts(last_seen_at DESC)`;
  yield* sql`CREATE INDEX idx_observed_posts_author ON observed_posts(author_id, created_at DESC)`;

  // Append-only so growth charts are a range query, never a diff.
  yield* sql`
    CREATE TABLE post_metrics (
      post_id TEXT NOT NULL REFERENCES observed_posts(post_id),
      observed_at TEXT NOT NULL,
      source TEXT NOT NULL,
      viewer_handle TEXT,
      views INTEGER,
      likes INTEGER NOT NULL,
      reposts INTEGER NOT NULL,
      replies INTEGER NOT NULL,
      quotes INTEGER NOT NULL,
      bookmarks INTEGER NOT NULL,
      PRIMARY KEY (post_id, observed_at)
    )
  `;
});
