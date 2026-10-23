import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Round 2 leads and automate: rule model v2, approval queue, scheduled undos,
// polled engagers, webhook events, person tiers and agent filters. Owned by the leads agent.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Rule v2 columns. A v1 row keeps working: its trigger and action JSON are still members of the v2 unions.
  yield* sql`ALTER TABLE rules ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}'`;
  yield* sql`ALTER TABLE rules ADD COLUMN wait_minutes INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE rules ADD COLUMN budget_usd_day REAL NOT NULL DEFAULT 1`;
  yield* sql`ALTER TABLE rules ADD COLUMN spent_usd_day REAL NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE rules ADD COLUMN spent_day TEXT NOT NULL DEFAULT ''`;
  yield* sql`ALTER TABLE rules ADD COLUMN ask_first INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE rules ADD COLUMN undo_after_hours INTEGER`;
  yield* sql`ALTER TABLE rules ADD COLUMN webhook_secret TEXT NOT NULL DEFAULT ''`;
  // Converter: v1 rules had only a monthly cap, so the new daily cap equals it and refuses nothing new;
  // delete rules were already shown as "ask first" in the UI, so they now really are; every rule gets a webhook secret.
  yield* sql`UPDATE rules SET budget_usd_day = budget_usd_month`;
  yield* sql`UPDATE rules SET ask_first = 1 WHERE json_extract(action_json, '$.kind') = 'auto_delete'`;
  yield* sql`UPDATE rules SET webhook_secret = lower(hex(randomblob(16)))`;

  yield* sql`ALTER TABLE rule_runs ADD COLUMN x_id TEXT`;

  yield* sql`
    CREATE TABLE pending_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL,
      subject_json TEXT NOT NULL,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      run_id INTEGER
    )
  `;
  yield* sql`CREATE INDEX idx_pending_rule ON pending_requests(rule_id, status)`;

  // The inverse of an ok run, due later. undo_json is the engine's own Undo shape, not a rule Action.
  yield* sql`
    CREATE TABLE scheduled_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL,
      undo_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'due'
    )
  `;

  // Who liked or reposted a watched post, as the 15-minute poll saw them.
  yield* sql`
    CREATE TABLE engagers (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      via TEXT NOT NULL,
      handle TEXT NOT NULL,
      name TEXT NOT NULL,
      followers INTEGER,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id, via)
    )
  `;

  yield* sql`
    CREATE TABLE webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      body_json TEXT NOT NULL,
      at TEXT NOT NULL
    )
  `;

  yield* sql`ALTER TABLE people ADD COLUMN tier TEXT`;

  yield* sql`ALTER TABLE agents ADD COLUMN lang TEXT`;
  yield* sql`ALTER TABLE agents ADD COLUMN exclude_bots INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE agents ADD COLUMN notify_min_score INTEGER`;
  yield* sql`ALTER TABLE agents ADD COLUMN list_id INTEGER`;
});
