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

it.effect("gives every stored sighting the account its post was captured under", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* migrate({ loader: loaderUpTo(16) });
    yield* sql`INSERT INTO observed_authors (user_id, handle, name, first_seen_at, last_seen_at) VALUES ('10', 'levelsio', 'P', 'a', 'a')`;
    for (const [postId, account] of [
      ["1", 1],
      ["2", 2],
    ] as const) {
      yield* sql`INSERT INTO observed_posts (post_id, author_id, text, created_at, first_seen_at, last_seen_at, account_id) VALUES (${postId}, '10', 't', 'a', 'a', 'a', ${account})`;
      for (const at of ["a", "b"])
        yield* sql`INSERT INTO post_metrics (post_id, observed_at, source, likes, reposts, replies, quotes, bookmarks) VALUES (${postId}, ${at}, 'home', 0, 0, 0, 0, 0)`;
    }

    yield* migrate({ loader: loaderUpTo(17) });

    expect(
      yield* sql`SELECT post_id, account_id FROM post_metrics ORDER BY post_id, observed_at`,
    ).toEqual([
      { post_id: "1", account_id: 1 },
      { post_id: "1", account_id: 1 },
      { post_id: "2", account_id: 2 },
      { post_id: "2", account_id: 2 },
    ]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
