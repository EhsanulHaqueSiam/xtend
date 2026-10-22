import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Tables for the Leads and Automate screens. Owned by the leads area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      user_id TEXT,
      followers INTEGER,
      bio TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'new',
      notes TEXT NOT NULL DEFAULT '',
      score INTEGER,
      source TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_activity TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      at TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    )
  `;
  yield* sql`CREATE INDEX idx_activity_person ON activity(person_id, at DESC)`;
  yield* sql`
    CREATE TABLE lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE list_members (
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, person_id)
    )
  `;
  yield* sql`
    CREATE TABLE agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      min_followers INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      last_run TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      scoring_prompt TEXT NOT NULL DEFAULT ''
    )
  `;
  yield* sql`
    CREATE TABLE agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      found INTEGER NOT NULL,
      inserted INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      error TEXT
    )
  `;
  yield* sql`CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id, id DESC)`;
  yield* sql`
    CREATE TABLE followers_seen (
      user_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      first_seen_at TEXT NOT NULL
    )
  `;

  // Automate. Trigger and action are JSON of the contract unions; spent_month resets the counter when the month changes.
  yield* sql`
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger TEXT NOT NULL,
      condition_json TEXT NOT NULL,
      action_json TEXT NOT NULL,
      budget_usd_month REAL NOT NULL DEFAULT 1,
      spent_usd_month REAL NOT NULL DEFAULT 0,
      spent_month TEXT NOT NULL DEFAULT '',
      dry_run INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE rule_fired (
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (rule_id, subject_id)
    )
  `;
  yield* sql`
    CREATE TABLE rule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      cost_usd REAL NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX idx_rule_runs_rule ON rule_runs(rule_id, id DESC)`;
});
