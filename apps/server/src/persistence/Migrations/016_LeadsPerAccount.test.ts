import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationEntries } from "../Migrations.ts";

const loader = (keep: (id: number) => boolean) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries.filter(([id]) => keep(id)).map(([id, name, m]) => [`${id}_${name}`, m]),
    ),
  );
const migrate = Migrator.make({});

it.effect("keeps every person, their activity and list membership, keyed per account", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // As in production: with foreign keys on, dropping people would cascade to its children.
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* migrate({ loader: loader((id) => id < 16) });
    yield* sql`
      INSERT INTO people (handle, name, source, first_seen, last_activity, stage, tier)
      VALUES ('alice', 'Alice', 'manual', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'customer', 'Gold')`;
    yield* sql`INSERT INTO activity (person_id, kind, at, detail) VALUES (1, 'dm', '2026-10-01T00:00:00.000Z', 'hi')`;
    yield* sql`INSERT INTO lists (name, created_at) VALUES ('Founders', '2026-10-01T00:00:00.000Z')`;
    yield* sql`INSERT INTO list_members (list_id, person_id) VALUES (1, 1)`;
    yield* sql`INSERT INTO followers_seen (user_id, handle, first_seen_at) VALUES ('7', 'ada', '2026-10-01T00:00:00.000Z')`;

    yield* migrate({ loader: loader((id) => id <= 16) });

    expect(yield* sql`SELECT id, handle, stage, tier, account_id FROM people`).toEqual([
      { id: 1, handle: "alice", stage: "customer", tier: "Gold", account_id: 1 },
    ]);
    expect(yield* sql`SELECT person_id, kind FROM activity`).toEqual([
      { person_id: 1, kind: "dm" },
    ]);
    expect(yield* sql`SELECT list_id, person_id FROM list_members`).toEqual([
      { list_id: 1, person_id: 1 },
    ]);
    expect(yield* sql`SELECT * FROM sqlite_master WHERE name LIKE '%_keep'`).toEqual([]);

    // A second account files its own @alice and sees @ada follow it. PeopleStore names the
    // account on insert: the uniqueness check runs before 014's trigger could stamp it.
    yield* sql`
      INSERT INTO people (handle, name, source, first_seen, last_activity, account_id)
      VALUES ('ALICE', 'Alice', 'manual', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 2)`;
    yield* sql`INSERT INTO followers_seen (user_id, handle, first_seen_at, account_id) VALUES ('7', 'ada', '2026-10-02T00:00:00.000Z', 2)`;
    expect(yield* sql`SELECT id, account_id FROM people ORDER BY id`).toEqual([
      { id: 1, account_id: 1 },
      { id: 2, account_id: 2 },
    ]);
    expect(yield* sql`SELECT account_id FROM followers_seen ORDER BY account_id`).toEqual([
      { account_id: 1 },
      { account_id: 2 },
    ]);
    // Within one account a handle is still one person, whatever the case.
    const again = yield* sql`
      INSERT INTO people (handle, name, source, first_seen, last_activity, account_id)
      VALUES ('Alice', 'Alice', 'manual', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 2)`.pipe(
      Effect.flip,
    );
    expect(again.reason._tag).toBe("UniqueViolation");
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
