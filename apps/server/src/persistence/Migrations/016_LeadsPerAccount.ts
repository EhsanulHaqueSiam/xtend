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

// A person and a seen follower are unique per account, not per install: with a handle unique
// across accounts, a second account could not file @alice once the first had her. SQLite cannot
// change a UNIQUE in place, so both tables are rebuilt. Migrations run in one transaction with
// foreign keys on, where dropping people cascades to its children, so those are set aside and
// put back. The rebuilt tables lose 014's stamping trigger with the old table; it is recreated.
// Owned by the leads area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE activity_keep AS SELECT * FROM activity`;
  yield* sql`CREATE TABLE list_members_keep AS SELECT * FROM list_members`;
  yield* sql`
    CREATE TABLE people_next (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      user_id TEXT,
      followers INTEGER,
      bio TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'new',
      notes TEXT NOT NULL DEFAULT '',
      score INTEGER,
      source TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      tier TEXT,
      account_id INTEGER NOT NULL DEFAULT 1,
      UNIQUE (account_id, handle)
    )
  `;
  yield* sql`
    INSERT INTO people_next (id, handle, name, user_id, followers, bio, stage, notes, score, source, first_seen, last_activity, tier, account_id)
    SELECT id, handle, name, user_id, followers, bio, stage, notes, score, source, first_seen, last_activity, tier, account_id FROM people
  `;
  yield* sql`DROP TABLE people`;
  yield* sql`ALTER TABLE people_next RENAME TO people`;
  yield* sql`INSERT INTO activity SELECT * FROM activity_keep`;
  yield* sql`INSERT INTO list_members SELECT * FROM list_members_keep`;
  yield* sql`DROP TABLE activity_keep`;
  yield* sql`DROP TABLE list_members_keep`;
  yield* sql.unsafe(stampAccount("people"));

  yield* sql`
    CREATE TABLE followers_seen_next (
      user_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      account_id INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (account_id, user_id)
    )
  `;
  yield* sql`
    INSERT INTO followers_seen_next (user_id, handle, first_seen_at, account_id)
    SELECT user_id, handle, first_seen_at, account_id FROM followers_seen
  `;
  yield* sql`DROP TABLE followers_seen`;
  yield* sql`ALTER TABLE followers_seen_next RENAME TO followers_seen`;
  yield* sql.unsafe(stampAccount("followers_seen"));
});
