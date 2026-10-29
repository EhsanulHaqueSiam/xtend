import type { ObservationBatch } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterAll, expect, test } from "vite-plus/test";

import * as Seed from "../testing/seed.ts";
import * as ObservationStore from "./ObservationStore.ts";

// Into a heavy user's database, so every upsert walks indexes of realistic depth.
const runtime = ManagedRuntime.make(Seed.layer);
afterAll(() => runtime.dispose());

/** What one 100-tweet timeline response sends: 50 posts never seen and the 50 before them again. */
const batch = (b: number): ObservationBatch => {
  const first = Seed.SIZES.observedPosts + b * 50;
  return {
    viewerHandle: Seed.HANDLE,
    accountId: 1,
    source: "home",
    observedAt: DateTime.formatIso(DateTime.makeUnsafe(Seed.SEED_NOW + b * 6 * 3_600_000)),
    posts: [
      ...Array.from({ length: 50 }, (_, i) => Seed.observedPost(first + i)),
      ...Array.from({ length: 50 }, (_, i) => Seed.observedPost(first - 50 + i, 1)),
    ],
  };
};

const record = (next: ObservationBatch) =>
  runtime.runPromise(ObservationStore.ObservationStore.use((store) => store.record(next)));

test("ObservationStore.record", async ({ bench }) => {
  let b = 0;
  let next = batch(b);
  expect(await record(next)).toEqual({ posts: 100 });
  // Every capture waits on this, and SQLite holds its write lock for the whole transaction.
  await bench(
    "record a 100-post batch",
    {
      beforeEach: () => {
        next = batch(++b);
      },
    },
    async () => {
      await record(next);
    },
  ).run();
});
