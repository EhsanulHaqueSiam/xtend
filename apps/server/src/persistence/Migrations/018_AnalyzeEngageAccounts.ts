import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const stampAccount = (table: string) => `
  CREATE TRIGGER trg_${table}_account AFTER INSERT ON ${table}
  WHEN NEW.account_id = 1 AND (SELECT current_account_id FROM settings WHERE id = 1) <> 1
  BEGIN
    UPDATE ${table} SET account_id = (SELECT current_account_id FROM settings WHERE id = 1)
    WHERE rowid = NEW.rowid;
  END
`;

/**
 * Private post metrics, their nightly runs and the niche profile become per account. A metrics row
 * follows its post's account; runs and the niche row go to account 1 and the current account.
 * niche_profile was pinned to one row (CHECK id = 1), so it is rebuilt keyed by account.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const table of ["post_analytics", "post_analytics_runs"]) {
    yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1`);
    yield* sql.unsafe(stampAccount(table));
  }
  yield* sql`
    UPDATE post_analytics SET account_id = COALESCE(
      (SELECT account_id FROM account_posts WHERE account_posts.post_id = post_analytics.post_id),
      1
    )
  `;

  yield* sql`
    CREATE TABLE niche_profile_next (
      account_id INTEGER PRIMARY KEY,
      handles_json TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO niche_profile_next (account_id, handles_json, topics_json, updated_at)
    SELECT COALESCE((SELECT current_account_id FROM settings WHERE id = 1), 1), handles_json, topics_json, updated_at
    FROM niche_profile
  `;
  yield* sql`DROP TABLE niche_profile`;
  yield* sql`ALTER TABLE niche_profile_next RENAME TO niche_profile`;
});
