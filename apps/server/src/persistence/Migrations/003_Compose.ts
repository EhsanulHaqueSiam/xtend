import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Tables for the Compose and Plan screens. Owned by the compose area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per editor session; threads keep their blocks as JSON, articles use title + body.
  yield* sql`
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'thread',
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      blocks_json TEXT NOT NULL DEFAULT '[]',
      reply_settings TEXT NOT NULL DEFAULT 'everyone',
      poll_json TEXT,
      hide_link_previews INTEGER NOT NULL DEFAULT 0,
      thread_delay_seconds INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      post_ids_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      posted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_drafts_status_scheduled ON drafts(status, scheduled_at)`;

  // Posting slots in local time; the queue fills the first future slot without a queued draft.
  yield* sql`
    CREATE TABLE slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weekday_mask INTEGER NOT NULL DEFAULT 127,
      minute_of_day INTEGER NOT NULL
    )
  `;
  yield* sql`INSERT INTO slots (minute_of_day) VALUES (540), (780), (1080)`;

  // Append-only log of scheduler attempts.
  yield* sql`
    CREATE TABLE queue_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id TEXT NOT NULL,
      at TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    )
  `;
  yield* sql`CREATE INDEX idx_queue_runs_draft ON queue_runs(draft_id, id DESC)`;
});
