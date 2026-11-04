import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// X's settings values the account's pages last showed, and each change Xtend saw, per account:
// toggles and picks only, never what the user types on X.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE x_settings_seen (
      account_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (account_id, key)
    )
  `;
  yield* sql`
    CREATE TABLE x_settings_changes (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      page TEXT NOT NULL,
      label TEXT NOT NULL,
      from_value TEXT NOT NULL,
      to_value TEXT NOT NULL,
      in_xtend INTEGER NOT NULL,
      at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX x_settings_changes_account ON x_settings_changes (account_id, at)`;
});
