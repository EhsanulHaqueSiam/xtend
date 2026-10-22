import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Tables for the library area and its paired engage screen. Owned by that area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      built_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `;
  // id 1 is "Staff picks": read-only, filled from the picks of the day.
  yield* sql`INSERT INTO collections (id, name, built_in, created_at) VALUES (1, 'Staff picks', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

  // The whole XPost is kept as JSON so the metrics stay frozen at save time.
  yield* sql`
    CREATE TABLE saved_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL UNIQUE,
      post_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      saved_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE collection_posts (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      saved_id INTEGER NOT NULL REFERENCES saved_posts(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, saved_id)
    )
  `;

  yield* sql`
    CREATE TABLE picks (
      day TEXT NOT NULL,
      keyword TEXT NOT NULL,
      post_id TEXT NOT NULL,
      post_json TEXT NOT NULL,
      why_it_works TEXT,
      draft_json TEXT,
      PRIMARY KEY (day, post_id)
    )
  `;
  // One paid search per keyword per day, even when it returned nothing.
  yield* sql`CREATE TABLE pick_fetches (day TEXT NOT NULL, keyword TEXT NOT NULL, PRIMARY KEY (day, keyword))`;

  // Drafts the library wrote for the user; Compose owns the real drafts table.
  yield* sql`
    CREATE TABLE suggested_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE replies_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_post_id TEXT NOT NULL,
      target_url TEXT NOT NULL,
      target_handle TEXT NOT NULL,
      text TEXT NOT NULL,
      post_id TEXT,
      error TEXT,
      at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_replies_sent_target ON replies_sent(target_post_id)`;

  yield* sql`CREATE TABLE handled_mentions (post_id TEXT PRIMARY KEY, at TEXT NOT NULL)`;
});
