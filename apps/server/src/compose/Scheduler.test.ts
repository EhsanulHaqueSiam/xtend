import { describe, expect, it } from "@effect/vitest";
import { XApiError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as XClient from "../x/XClient.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as Scheduler from "./Scheduler.ts";

// Records createPost calls; fails when the text contains "boom".
const calls: Array<XClient.CreatePostInput> = [];
const unused = () => Effect.die("not used in this test");
const xStub = Layer.succeed(XClient.XClient)({
  createPost: (input) =>
    Effect.gen(function* () {
      calls.push(input);
      if (input.text.includes("boom"))
        return yield* new XApiError({
          endpoint: "x",
          reason: "provider",
          status: 401,
          detail: "OAuth refresh failed",
        });
      return { postId: String(calls.length), costUsd: 0.015 };
    }),
  searchPosts: unused,
  profile: unused,
  userPosts: unused,
  followers: unused,
  trending: unused,
  me: unused,
  deletePost: unused,
  like: unused,
  repost: unused,
  sendDm: unused,
  mentions: unused,
  cached: {
    search: unused,
    profile: unused,
    userPosts: unused,
    followers: unused,
    trending: unused,
    mentions: Effect.succeed(false),
  },
});

const layerTest = Scheduler.layerService.pipe(
  Layer.provideMerge(Publisher.layer),
  Layer.provideMerge(Layer.mergeAll(DraftStore.layer, SettingsStore.layer)),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, xStub, TokenCipher.layerTest)),
);

describe("Scheduler", () => {
  // it.live: the backoff compares against the real clock, not the TestClock at epoch 0.
  it.live("posts due threads as replies and retries failures with backoff", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;
      const past = "2026-01-01T00:00:00.000Z";

      const ok = yield* drafts.create({ blocks: [{ text: "one" }, { text: "two" }] });
      yield* drafts.setOutcome(ok.id, { status: "queued", scheduledAt: past });
      const bad = yield* drafts.create({ blocks: [{ text: "boom" }] });
      yield* drafts.setOutcome(bad.id, { status: "queued", scheduledAt: past });
      const future = yield* drafts.create({ blocks: [{ text: "later" }] });
      yield* drafts.setOutcome(future.id, {
        status: "queued",
        scheduledAt: "2999-01-01T00:00:00.000Z",
      });

      const touched = yield* scheduler.tick;
      expect(touched).toHaveLength(2);
      expect(calls.map((c) => c.replyToPostId)).toEqual([undefined, "1", undefined]);

      const posted = yield* drafts.get(ok.id);
      expect(posted.status).toBe("posted");
      expect(posted.postIds).toEqual(["1", "2"]);

      const retried = yield* drafts.get(bad.id);
      expect(retried.status).toBe("queued");
      expect(retried.attempts).toBe(1);
      expect(retried.error).toContain("OAuth refresh failed");
      expect(retried.scheduledAt! > past).toBe(true);

      // Third failure gives up.
      yield* drafts.setOutcome(bad.id, { scheduledAt: past, attempts: 2 });
      yield* scheduler.tick;
      const failed = yield* drafts.get(bad.id);
      expect(failed.status).toBe("failed");
      expect(yield* drafts.runs(bad.id)).toHaveLength(2);
      expect((yield* drafts.get(future.id)).status).toBe("queued");
    }).pipe(Effect.provide(layerTest)),
  );
});
