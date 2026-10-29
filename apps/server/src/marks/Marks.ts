import type { Mark, MarkSubject } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";

/** One batch is what fits on a timeline screen; a longer list is trimmed, never paged. */
const MAX_POSTS = 200;

/**
 * Marks for a batch of posts, read from the tables the tools already write:
 * sent replies, saved posts, rule runs by post; people and watch by author.
 * Nothing is fetched; a post nobody touched is absent from the answer.
 */
export const forPosts = Effect.fn("Marks.forPosts")(function* (posts: ReadonlyArray<MarkSubject>) {
  const marks: Record<string, Array<Mark>> = {};
  const subjects = posts.slice(0, MAX_POSTS);
  if (subjects.length === 0) return marks;
  const sql = yield* SqlClient.SqlClient;
  const account = sql.literal(CURRENT_ACCOUNT);
  const ids = subjects.map((p) => p.postId);
  const handles = [...new Set(subjects.map((p) => p.handle.toLowerCase()))];
  const add = (postId: string, mark: Mark) => (marks[postId] ??= []).push(mark);

  const replied = yield* sql<{ post_id: string; at: string }>`
    SELECT target_post_id AS post_id, MAX(at) AS at FROM replies_sent
    WHERE account_id = ${account} AND error IS NULL AND target_post_id IN ${sql.in(ids)}
    GROUP BY target_post_id
  `;
  for (const r of replied) add(r.post_id, { kind: "replied", detail: null, at: r.at });

  const saved = yield* sql<{ post_id: string }>`
    SELECT post_id FROM saved_posts WHERE account_id = ${account} AND post_id IN ${sql.in(ids)}
  `;
  for (const r of saved) add(r.post_id, { kind: "saved", detail: null, at: null });

  const runs = yield* sql<{ post_id: string; at: string; name: string }>`
    SELECT r.subject_id AS post_id, MAX(r.at) AS at, rules.name AS name FROM rule_runs r
    JOIN rules ON rules.id = r.rule_id
    WHERE rules.account_id = ${account} AND r.status = 'ok' AND r.subject_id IN ${sql.in(ids)}
    GROUP BY r.subject_id
  `;
  for (const r of runs) add(r.post_id, { kind: "auto", detail: r.name, at: r.at });

  const people = yield* sql<{ handle: string; stage: string }>`
    SELECT handle, stage FROM people WHERE account_id = ${account} AND handle IN ${sql.in(handles)}
  `;
  const stages = new Map(people.map((p) => [p.handle.toLowerCase(), p.stage]));
  const watched = yield* sql<{ handle: string }>`
    SELECT handle FROM watch WHERE account_id = ${account} AND handle IN ${sql.in(handles)}
  `;
  const watching = new Set(watched.map((w) => w.handle.toLowerCase()));
  for (const p of subjects) {
    const handle = p.handle.toLowerCase();
    const stage = stages.get(handle);
    if (stage !== undefined) add(p.postId, { kind: "lead", detail: stage, at: null });
    if (watching.has(handle)) add(p.postId, { kind: "watching", detail: null, at: null });
  }
  return marks;
});
