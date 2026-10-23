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

it.effect("backfills v13 rows to account 1 and stamps new rows with the current account", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* migrate({ loader: loaderUpTo(13) });
    yield* sql`UPDATE settings SET handle = 'siam' WHERE id = 1`;
    yield* sql`INSERT INTO watch (handle, added_at) VALUES ('levelsio', '2026-10-01T00:00:00Z')`;
    yield* sql`INSERT INTO slots (minute_of_day) VALUES (600)`;

    yield* migrate({ loader: loaderUpTo(14) });

    const accounts = yield* sql<{
      id: number;
      handle: string;
      label: string;
    }>`SELECT * FROM accounts`;
    expect(accounts).toMatchObject([{ id: 1, handle: "siam", label: "siam" }]);
    const watch = yield* sql<{ account_id: number }>`SELECT account_id FROM watch`;
    expect(watch).toEqual([{ account_id: 1 }]);
    const slots = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM slots WHERE account_id = 1`;
    expect(slots[0]?.n).toBe(4);

    yield* sql`INSERT INTO accounts (id, handle, label, created_at) VALUES (2, 'ghost', 'Ghost', '2026-10-02T00:00:00Z')`;
    yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
    yield* sql`INSERT INTO watch (handle, added_at) VALUES ('naval', '2026-10-02T00:00:00Z')`;
    const stamped = yield* sql<{ handle: string; account_id: number }>`
      SELECT handle, account_id FROM watch ORDER BY handle
    `;
    expect(stamped).toEqual([
      { handle: "levelsio", account_id: 1 },
      { handle: "naval", account_id: 2 },
    ]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
