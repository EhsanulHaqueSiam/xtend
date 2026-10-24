import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * saved_posts, library_posts and watch were unique across accounts, so a second account
 * could not save, archive or watch what the first already had. Rekeyed per account.
 * Owned by the library and scores area.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Foreign keys are on here, so dropping saved_posts while collection_posts points at it would
  // cascade every collection link away. Both are rebuilt and the old pair dropped child first;
  // renaming saved_posts_new rewrites the reference collection_posts_new holds.
  yield* sql`
    CREATE TABLE saved_posts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL DEFAULT 1,
      post_id TEXT NOT NULL,
      post_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      saved_at TEXT NOT NULL,
      UNIQUE (account_id, post_id)
    )
  `;
  yield* sql`
    INSERT INTO saved_posts_new (id, account_id, post_id, post_json, note, saved_at)
    SELECT id, account_id, post_id, post_json, note, saved_at FROM saved_posts
  `;
  yield* sql`
    CREATE TABLE collection_posts_new (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      saved_id INTEGER NOT NULL REFERENCES saved_posts_new(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, saved_id)
    )
  `;
  yield* sql`INSERT INTO collection_posts_new SELECT collection_id, saved_id FROM collection_posts`;
  yield* sql`DROP TABLE collection_posts`;
  yield* sql`DROP TABLE saved_posts`;
  yield* sql`ALTER TABLE saved_posts_new RENAME TO saved_posts`;
  yield* sql`ALTER TABLE collection_posts_new RENAME TO collection_posts`;

  yield* sql`
    CREATE TABLE library_posts_new (
      account_id INTEGER NOT NULL DEFAULT 1,
      post_id TEXT NOT NULL,
      post_json TEXT NOT NULL,
      author_followers INTEGER,
      views INTEGER,
      lang TEXT,
      year INTEGER NOT NULL,
      format TEXT NOT NULL,
      hook_pattern TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (account_id, post_id)
    )
  `;
  yield* sql`
    INSERT INTO library_posts_new (account_id, post_id, post_json, author_followers, views, lang, year, format, hook_pattern, first_seen_at, last_seen_at)
    SELECT account_id, post_id, post_json, author_followers, views, lang, year, format, hook_pattern, first_seen_at, last_seen_at FROM library_posts
  `;
  yield* sql`DROP TABLE library_posts`;
  yield* sql`ALTER TABLE library_posts_new RENAME TO library_posts`;
  yield* sql`CREATE INDEX idx_library_posts_views ON library_posts(account_id, views DESC)`;

  yield* sql`
    CREATE TABLE watch_new (
      account_id INTEGER NOT NULL DEFAULT 1,
      handle TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (account_id, handle)
    )
  `;
  yield* sql`INSERT INTO watch_new (account_id, handle, added_at) SELECT account_id, handle, added_at FROM watch`;
  yield* sql`DROP TABLE watch`;
  yield* sql`ALTER TABLE watch_new RENAME TO watch`;

  // Dropping a table drops its triggers; these are 014's account stamps, unchanged.
  for (const table of ["saved_posts", "library_posts", "watch"]) {
    yield* sql.unsafe(`
      CREATE TRIGGER trg_${table}_account AFTER INSERT ON ${table}
      WHEN NEW.account_id = 1 AND (SELECT current_account_id FROM settings WHERE id = 1) <> 1
      BEGIN
        UPDATE ${table} SET account_id = (SELECT current_account_id FROM settings WHERE id = 1)
        WHERE rowid = NEW.rowid;
      END
    `);
  }
});
