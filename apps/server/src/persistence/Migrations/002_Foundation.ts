import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One settings row; columns rather than key/value so the schema types it.
  yield* sql`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      handle TEXT,
      treg_token TEXT,
      monthly_budget_usd REAL NOT NULL DEFAULT 50,
      session_posting_enabled INTEGER NOT NULL DEFAULT 0,
      voice_notes TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`INSERT INTO settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

  // Append-only. The budget check sums this; the Settings meter reads it.
  yield* sql`
    CREATE TABLE spend_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      purpose TEXT NOT NULL,
      cost_usd REAL NOT NULL
    )
  `;
  yield* sql`CREATE INDEX idx_spend_log_at ON spend_log(at DESC)`;

  // Cache of provider reads keyed by endpoint + input, so screens re-render for free
  // and a scheduled job never pays twice for the same hour.
  yield* sql`
    CREATE TABLE x_cache (
      cache_key TEXT PRIMARY KEY,
      body_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `;
});
