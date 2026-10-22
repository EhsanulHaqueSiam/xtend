import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Assist from "../ai/Assist.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as Engage from "./Engage.ts";
import * as EngageStore from "./EngageStore.ts";

const mention = (postId: string): XPost => ({
  postId,
  url: `https://x.com/a/status/${postId}`,
  text: "@siam hi",
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: null,
  isReply: true,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: "2", handle: "a", name: "A", followers: 1, verified: false, avatarUrl: null },
  metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const apiCalls: Array<string | undefined> = [];
const assistStub = Layer.succeed(Assist.Assist)({ generate: () => Effect.die("no model here") });

const layerTest = Engage.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(EngageStore.layer, ObservationStore.layer, SettingsStore.layer, assistStub),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        mentions: ({ sinceId }) => {
          apiCalls.push(sinceId);
          return Effect.succeed(
            sinceId === undefined ? [mention("10"), mention("12")] : [mention("15")],
          );
        },
      }),
    ),
  ),
);

describe("Engage.mentions", () => {
  it.effect("pays X only on refresh, and then only for mentions newer than the last one", () =>
    Effect.gen(function* () {
      apiCalls.length = 0;
      const engage = yield* Engage.Engage;
      expect((yield* engage.mentions(false)).mentions).toEqual([]);
      expect(apiCalls).toEqual([]);
      expect((yield* engage.mentions(true)).mentions.map((m) => m.post.postId)).toEqual([
        "12",
        "10",
      ]);
      expect((yield* engage.mentions(false)).mentions).toHaveLength(2);
      expect((yield* engage.mentions(true)).mentions.map((m) => m.post.postId)).toEqual([
        "15",
        "12",
        "10",
      ]);
      expect(apiCalls).toEqual([undefined, "12"]);
    }).pipe(Effect.provide(layerTest)),
  );
});
