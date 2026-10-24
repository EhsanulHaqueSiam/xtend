import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as ComposeAssist from "./ComposeAssist.ts";

// The model answers a score above 1, as models do; it sees what the service sends it.
const seen: Array<unknown> = [];
const assistStub = Layer.succeed(Assist.Assist)({
  generate: (request) => {
    seen.push(request.input);
    return Schema.decodeUnknownEffect(request.output)({ score: 1.4, note: "shorter" }).pipe(
      Effect.orDie,
    );
  },
});

const reads: Array<string> = [];
const post = (n: number, isRepost: boolean): XPost => ({
  postId: String(n),
  url: `https://x.com/siam/status/${n}`,
  text: isRepost ? `someone else ${n}` : `mine ${n}`,
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "10",
    handle: "siam",
    name: "Siam",
    followers: 100,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views: 10, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const layerTest = ComposeAssist.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      assistStub,
      xClientStub({
        userPosts: (handle) =>
          Effect.sync(() => {
            reads.push(handle);
            return {
              items: Array.from({ length: 30 }, (_, i) => post(i + 1, i % 3 === 0)),
              nextCursor: null,
              fromCache: false,
            };
          }),
      }),
    ),
  ),
);

describe("ComposeAssist", () => {
  it.effect(
    "voice match compares with the user's own recent posts and keeps the score in 0..1",
    () =>
      Effect.gen(function* () {
        const assist = yield* ComposeAssist.ComposeAssist;
        const settings = yield* SettingsStore.SettingsStore;
        // No handle: nothing to read, so no paid X call.
        expect((yield* assist.voiceMatch(["draft"])).samples).toBe(0);
        expect(reads).toEqual([]);

        yield* settings.update({ handle: "siam" });
        const match = yield* assist.voiceMatch(["draft"]);
        expect(match).toEqual({ score: 1, note: "shorter", samples: 20 });
        const { samples } = Schema.decodeUnknownSync(
          Schema.Struct({ samples: Schema.Array(Schema.String) }),
        )(seen.at(-1));
        expect(samples.every((t) => t.startsWith("mine"))).toBe(true);
      }).pipe(Effect.provide(layerTest)),
  );
});
