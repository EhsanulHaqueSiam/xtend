import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationEntries } from "../Migrations.ts";

const loaderUpTo = (n: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries.filter(([id]) => id <= n).map(([id, name, m]) => [`${id}_${name}`, m]),
    ),
  );
const migrate = Migrator.make({});

it.effect("rekeys saved, archive and watch rows per account without losing collection links", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // As in production: with foreign keys on, a careless rebuild cascades collection_posts away.
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* migrate({ loader: loaderUpTo(14) });
    yield* sql`INSERT INTO collections (id, name, created_at) VALUES (2, 'Ideas', '2026-10-01T00:00:00Z')`;
    yield* sql`INSERT INTO saved_posts (id, post_id, post_json, note, saved_at) VALUES (7, '100', '{}', 'kept', '2026-10-01T00:00:00Z')`;
    yield* sql`INSERT INTO collection_posts (collection_id, saved_id) VALUES (2, 7)`;
    yield* sql`INSERT INTO library_posts (post_id, post_json, views, year, format, hook_pattern, first_seen_at, last_seen_at) VALUES ('100', '{}', 50, 2026, 'text', 'list', 'a', 'b')`;
    yield* sql`INSERT INTO watch (handle, added_at) VALUES ('levelsio', '2026-10-01T00:00:00Z')`;

    yield* migrate({ loader: loaderUpTo(15) });

    expect(yield* sql`SELECT id, account_id, post_id, note FROM saved_posts`).toEqual([
      { id: 7, account_id: 1, post_id: "100", note: "kept" },
    ]);
    expect(yield* sql`SELECT collection_id, saved_id FROM collection_posts`).toEqual([
      { collection_id: 2, saved_id: 7 },
    ]);
    expect(yield* sql`SELECT account_id, hook_pattern FROM library_posts`).toEqual([
      { account_id: 1, hook_pattern: "list" },
    ]);

    // A second account can now hold the same post and handle.
    yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
    yield* sql`INSERT INTO saved_posts (account_id, post_id, post_json, saved_at) VALUES (2, '100', '{}', 'c')`;
    yield* sql`INSERT INTO library_posts (account_id, post_id, post_json, year, format, first_seen_at, last_seen_at) VALUES (2, '100', '{}', 2026, 'text', 'a', 'b')`;
    yield* sql`INSERT INTO watch (account_id, handle, added_at) VALUES (2, 'levelsio', 'c')`;
    // 014's stamp still applies to the rebuilt tables.
    yield* sql`INSERT INTO watch (handle, added_at) VALUES ('naval', 'c')`;
    expect(yield* sql`SELECT account_id FROM watch WHERE handle = 'naval'`).toEqual([
      { account_id: 2 },
    ]);
    const owners = (table: string) =>
      sql<{ account_id: number }>`SELECT account_id FROM ${sql(table)} ORDER BY account_id`.pipe(
        Effect.map((rows) => rows.map((r) => r.account_id)),
      );
    expect(yield* owners("saved_posts")).toEqual([1, 2]);
    expect(yield* owners("library_posts")).toEqual([1, 2]);
    expect(yield* owners("watch")).toEqual([1, 2, 2]);
    const fresh = yield* sql<{ id: number }>`SELECT id FROM saved_posts WHERE account_id = 2`;
    expect(fresh[0]!.id).toBeGreaterThan(7);

    // collection_posts still cascades from the rebuilt saved_posts.
    yield* sql`DELETE FROM saved_posts WHERE id = 7`;
    expect(yield* sql`SELECT * FROM collection_posts`).toEqual([]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
