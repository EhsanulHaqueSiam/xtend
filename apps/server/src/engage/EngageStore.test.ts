import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as EngageStore from "./EngageStore.ts";

const layerTest = EngageStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const replyTo = (targetPostId: string, targetHandle: string, postId: string | null) =>
  [
    {
      postId: targetPostId,
      url: `https://x.com/${targetHandle}/status/${targetPostId}`,
      text: `${targetHandle} says something`,
      createdAt: "2026-10-17T10:00:00.000Z",
      lang: "en",
      isReply: false,
      isRepost: false,
      hasMedia: false,
      hasLink: false,
      author: {
        userId: `9${targetPostId}`,
        handle: targetHandle,
        name: targetHandle,
        followers: 10,
        verified: false,
        avatarUrl: null,
      },
      metrics: { views: 1, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
    } satisfies XPost,
    { text: "good point", postId, error: postId === null ? "refused" : null },
  ] as const;

const followerSeen = (userId: string, handle: string, at: string, account = 1) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      INSERT INTO followers_seen (user_id, handle, first_seen_at, account_id)
      VALUES (${userId}, ${handle}, ${at}, ${account})`,
  );

const switchAccount = (id: number) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`,
  );

describe("EngageStore", () => {
  it.effect("credits a reply with its author following within 24 hours, past midnight too", () =>
    Effect.gen(function* () {
      const store = yield* EngageStore.EngageStore;
      yield* TestClock.setTime(Date.parse("2026-10-21T23:00:00.000Z"));
      yield* store.recordReply(...replyTo("1", "ann", "101"));
      // Next morning: inside the window although it is another calendar day.
      yield* followerSeen("11", "ann", "2026-10-22T09:00:00.000Z");
      // Past 24 hours, someone unrelated, and the same author following another account.
      yield* followerSeen("12", "ann", "2026-10-22T23:30:00.000Z");
      yield* followerSeen("13", "zed", "2026-10-22T08:00:00.000Z");
      yield* followerSeen("11", "ann", "2026-10-22T09:00:00.000Z", 2);
      expect((yield* store.sentList([])).map((r) => r.attributedFollowers)).toEqual([1]);
      // Someone who engaged with the user counts too when they follow in the window.
      expect((yield* store.sentList(["13"])).map((r) => r.attributedFollowers)).toEqual([2]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("asks for a follow-up on sent replies over two days old with nothing after them", () =>
    Effect.gen(function* () {
      const store = yield* EngageStore.EngageStore;
      yield* TestClock.setTime(Date.parse("2026-10-18T10:00:00.000Z"));
      yield* store.recordReply(...replyTo("1", "ann", "101"));
      yield* store.recordReply(...replyTo("2", "ben", "102"));
      yield* store.recordReply(...replyTo("3", "cat", null));
      yield* TestClock.setTime(Date.parse("2026-10-19T10:00:00.000Z"));
      yield* store.recordReply(...replyTo("2", "ben", "103"));
      yield* TestClock.setTime(Date.parse("2026-10-22T10:00:00.000Z"));
      yield* store.recordReply(...replyTo("4", "dan", "104"));
      expect((yield* store.followUps).map((r) => r.postId)).toEqual(["103", "101"]);
      expect([...(yield* store.repliedPostIds)].toSorted()).toEqual(["1", "2", "4"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "carries the answered post, and done or dismissed takes a follow-up off until reopened",
    () =>
      Effect.gen(function* () {
        const store = yield* EngageStore.EngageStore;
        yield* TestClock.setTime(Date.parse("2026-10-18T10:00:00.000Z"));
        const ann = yield* store.recordReply(...replyTo("1", "ann", "101"));
        const ben = yield* store.recordReply(...replyTo("2", "ben", "102"));
        yield* TestClock.setTime(Date.parse("2026-10-22T10:00:00.000Z"));
        expect((yield* store.followUps).map((r) => r.target?.text)).toEqual([
          "ben says something",
          "ann says something",
        ]);

        yield* store.closeFollowUp(ann.id, "done");
        yield* store.closeFollowUp(ben.id, "dismissed");
        expect(yield* store.followUps).toEqual([]);
        yield* store.closeFollowUp(ann.id, null);
        expect((yield* store.followUps).map((r) => r.postId)).toEqual(["101"]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps each account's niche and follow-ups to itself", () =>
    Effect.gen(function* () {
      const store = yield* EngageStore.EngageStore;
      yield* TestClock.setTime(Date.parse("2026-10-18T10:00:00.000Z"));
      yield* store.recordReply(...replyTo("1", "ann", "101"));
      yield* store.nicheSet({ handles: [{ handle: "ann", replies: 1 }], topics: ["api pricing"] });

      yield* switchAccount(2);
      expect(yield* store.nicheGet).toEqual({ handles: [], topics: [], updatedAt: null });
      // The other account replying to the same post does not settle this account's follow-up.
      yield* store.recordReply(...replyTo("1", "ann", "201"));
      yield* store.nicheSet({ handles: [], topics: ["design"] });

      yield* switchAccount(1);
      yield* TestClock.setTime(Date.parse("2026-10-22T10:00:00.000Z"));
      expect((yield* store.followUps).map((r) => r.postId)).toEqual(["101"]);
      expect((yield* store.nicheGet).topics).toEqual(["api pricing"]);
    }).pipe(Effect.provide(layerTest)),
  );
});
