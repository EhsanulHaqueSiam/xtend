import { describe, expect, it } from "@effect/vitest";
import type { ObservationBatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as BestTime from "./BestTime.ts";
import * as SlotStore from "./SlotStore.ts";
import { desktopStub } from "./testStubs.ts";

const layerTest = BestTime.layer.pipe(
  Layer.provideMerge(SlotStore.layer),
  Layer.provideMerge(Layer.mergeAll(SettingsStore.layer, ObservationStore.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      desktopStub([], () => Effect.die("no desktop commands in this test")),
    ),
  ),
);

/** One post by `handle`, written at `createdAt` and seen once with `views`. */
const seen = (
  postId: string,
  handle: string,
  createdAt: string,
  views: number,
): ObservationBatch => ({
  viewerHandle: "siam",
  source: "profile",
  observedAt: "2026-10-23T00:00:00.000Z",
  posts: [
    {
      postId,
      author: {
        userId: handle === "siam" ? "10" : "20",
        handle,
        name: handle,
        followers: 100,
        verified: false,
      },
      text: "post",
      createdAt,
      isReply: false,
      isRepost: false,
      isPromoted: false,
      hasMedia: false,
      hasLink: false,
      metrics: { views, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
    },
  ],
});

describe("BestTime", () => {
  it.effect("ranks the user's own posting hours in the account's zone once there are enough", () =>
    Effect.gen(function* () {
      const settings = yield* SettingsStore.SettingsStore;
      const observations = yield* ObservationStore.ObservationStore;
      const bestTime = yield* BestTime.BestTime;
      yield* settings.update({ handle: "siam", timeZone: "Asia/Dhaka" });
      // Wednesday 03:00 UTC is Wednesday 09:00 in Dhaka; the evening posts do worse.
      for (let i = 0; i < 6; i++)
        yield* observations.record(seen(`${i + 1}`, "siam", "2026-10-21T03:00:00.000Z", 5000));
      for (let i = 0; i < 3; i++)
        yield* observations.record(seen(`${i + 11}`, "siam", "2026-10-22T14:00:00.000Z", 50));
      // Someone else's viral post says nothing about the user's own hours.
      yield* observations.record(seen("99", "levelsio", "2026-10-20T00:00:00.000Z", 900000));

      const early = yield* bestTime.heatmap;
      expect(early.posts).toBe(9);
      expect(early.best).toEqual([]);
      expect(early.cells[3 * 24 + 9]).toBeGreaterThan(0);

      yield* observations.record(seen("21", "siam", "2026-10-22T14:00:00.000Z", 50));
      const ready = yield* bestTime.heatmap;
      expect(ready.best).toEqual([
        { weekday: 3, hour: 9 },
        { weekday: 4, hour: 20 },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );
});
