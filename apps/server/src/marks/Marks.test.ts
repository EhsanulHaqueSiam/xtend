import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as Marks from "./Marks.ts";

describe("Marks", () => {
  it.effect("collects replied, saved, auto by post and lead, watching by author", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO replies_sent (target_post_id, target_url, target_handle, text, post_id, at) VALUES ('1', 'u', 'sam', 'hi', '9', '2026-10-28T10:00:00.000Z')`;
      yield* sql`INSERT INTO replies_sent (target_post_id, target_url, target_handle, text, error, at) VALUES ('2', 'u', 'ann', 'hi', 'failed', '2026-10-28T10:00:00.000Z')`;
      yield* sql`INSERT INTO saved_posts (post_id, post_json, saved_at) VALUES ('1', '{}', '2026-10-28T11:00:00.000Z')`;
      yield* sql`INSERT INTO rules (id, name, trigger, condition_json, action_json, created_at) VALUES (5, 'thank reposters', 'repost', '{}', '{}', '2026-10-01T00:00:00.000Z')`;
      yield* sql`INSERT INTO rule_runs (rule_id, at, subject_id, status) VALUES (5, '2026-10-28T12:00:00.000Z', '2', 'ok'), (5, '2026-10-28T12:00:00.000Z', '3', 'skipped')`;
      yield* sql`INSERT INTO people (handle, name, source, first_seen, last_activity, stage) VALUES ('Sam', 'Sam', 'manual', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'warm')`;
      yield* sql`INSERT INTO watch (handle, added_at) VALUES ('ann', '2026-10-01T00:00:00.000Z')`;

      const marks = yield* Marks.forPosts([
        { postId: "1", handle: "sam" },
        { postId: "2", handle: "ann" },
        { postId: "3", handle: "bob" },
      ]);
      expect(marks).toEqual({
        "1": [
          { kind: "replied", detail: null, at: "2026-10-28T10:00:00.000Z" },
          { kind: "saved", detail: null, at: null },
          { kind: "lead", detail: "warm", at: null },
        ],
        "2": [
          { kind: "auto", detail: "thank reposters", at: "2026-10-28T12:00:00.000Z" },
          { kind: "watching", detail: null, at: null },
        ],
      });
    }).pipe(Effect.provide(Sqlite.layerMemory)),
  );
});
