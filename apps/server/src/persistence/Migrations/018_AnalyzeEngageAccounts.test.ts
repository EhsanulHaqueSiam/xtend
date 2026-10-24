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

it.effect(
  "files stored post metrics under their post's account and the niche under the current one",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* migrate({ loader: loaderUpTo(17) });
      // Each account refreshed its own timeline and fetched its posts' metrics; account 2 is current.
      for (const [postId, account] of [
        ["1", 1],
        ["2", 2],
      ] as const) {
        yield* sql`UPDATE settings SET current_account_id = ${account} WHERE id = 1`;
        yield* sql`INSERT INTO account_posts (post_id, handle, url, text, created_at, kind, likes, reposts, replies, quotes, bookmarks, fetched_at) VALUES (${postId}, 'h', 'u', 't', 'a', 'text', 0, 0, 0, 0, 0, 'a')`;
        yield* sql`INSERT INTO post_analytics (post_id, day, impressions, profile_visits, link_clicks, follows, likes, replies, reposts) VALUES (${postId}, '2026-10-22', 1, 0, 0, 0, 0, 0, 0)`;
      }
      yield* sql`INSERT INTO niche_profile (id, handles_json, topics_json, updated_at) VALUES (1, '[]', '["design"]', 'a')`;

      yield* migrate({ loader: loaderUpTo(18) });

      expect(yield* sql`SELECT post_id, account_id FROM post_analytics ORDER BY post_id`).toEqual([
        { post_id: "1", account_id: 1 },
        { post_id: "2", account_id: 2 },
      ]);
      expect(yield* sql`SELECT account_id, topics_json FROM niche_profile`).toEqual([
        { account_id: 2, topics_json: '["design"]' },
      ]);
      // New rows are stamped with the current account, like every other per-account table.
      yield* sql`INSERT INTO post_analytics_runs (at, posts) VALUES ('b', 0)`;
      expect(yield* sql`SELECT account_id FROM post_analytics_runs`).toEqual([{ account_id: 2 }]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
