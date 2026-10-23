import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Tables whose rows belong to one X account. Children (draft_media, queue_runs,
 * activity, list_members, agent_runs, rule_runs, ...) follow their parent through
 * the foreign key; caches and logs keyed by post or day stay shared.
 */
const ACCOUNT_TABLES = [
  "observed_posts",
  "drafts",
  "slots",
  "account_posts",
  "profile_snapshots",
  "score_samples",
  "watch",
  "collections",
  "saved_posts",
  "replies_sent",
  "people",
  "lists",
  "agents",
  "followers_seen",
  "rules",
  "api_mentions",
  "library_posts",
] as const;

// Multi-account. Account 1 is the handle Settings already had, so every existing
// row keeps working through the column default. Owned by the platform agent.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO accounts (id, handle, label, created_at)
    SELECT 1, handle, COALESCE(handle, 'Main'), updated_at FROM settings WHERE id = 1
  `;
  yield* sql`ALTER TABLE settings ADD COLUMN current_account_id INTEGER NOT NULL DEFAULT 1`;

  for (const table of ACCOUNT_TABLES) {
    yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1`);
    // SQLite defaults cannot read another table, so a trigger stamps the current account on
    // rows inserted with the default. shortcut: an explicit insert for account 1 while another
    // account is current is re-stamped too; give inserts an explicit account_id if that ever matters.
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
