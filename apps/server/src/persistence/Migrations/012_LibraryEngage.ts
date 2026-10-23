import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Round 2 tables for the library and engage screens. Owned by that agent.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Every post a search or a pick returned; columns the archive filters by are lifted out of the JSON.
  yield* sql`
    CREATE TABLE library_posts (
      post_id TEXT PRIMARY KEY,
      post_json TEXT NOT NULL,
      author_followers INTEGER,
      views INTEGER,
      lang TEXT,
      year INTEGER NOT NULL,
      format TEXT NOT NULL,
      hook_pattern TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_library_posts_views ON library_posts(views DESC)`;

  // One row: who the user talks to and about what. Rebuilt nightly.
  yield* sql`
    CREATE TABLE niche_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      handles_json TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // Daily jobs (picks, ready-to-post, niche) run once per local day.
  yield* sql`CREATE TABLE jobs_ran (job TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (job, day))`;
});
