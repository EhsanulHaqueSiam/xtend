import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      claude_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_threads_updated ON threads(updated_at DESC)`;

  // Append-only transcript. The UI folds events into messages; the agent resumes from Claude's own session.
  yield* sql`
    CREATE TABLE thread_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(thread_id),
      at TEXT NOT NULL,
      event_json TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_thread_events_thread ON thread_events(thread_id, sequence)`;
});
