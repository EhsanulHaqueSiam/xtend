import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as DraftStore from "./DraftStore.ts";
import * as SlotStore from "./SlotStore.ts";

const layerTest = Layer.mergeAll(DraftStore.layer, SlotStore.layer).pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

describe("DraftStore", () => {
  it.effect("round-trips blocks, poll and outcome fields", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const created = yield* store.create({
        blocks: [{ text: "hook" }, { text: "second" }],
        poll: { options: ["a", "b"], durationMinutes: 60 },
        threadDelaySeconds: 5,
      });
      expect(created.status).toBe("draft");
      const updated = yield* store.update(created.id, { blocks: [{ text: "new hook" }] });
      expect(updated.blocks).toEqual([{ text: "new hook" }]);
      expect(updated.poll?.options).toEqual(["a", "b"]);
      expect(updated.threadDelaySeconds).toBe(5);

      const posted = yield* store.setOutcome(created.id, { status: "posted", postIds: ["1", "2"] });
      expect(posted.postIds).toEqual(["1", "2"]);
      expect(yield* store.list).toHaveLength(1);
      yield* store.remove(created.id);
      expect(yield* store.list).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a library suggestion is a real draft with its source, listed on the Ready shelf", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const d = yield* store.create({
        blocks: [{ text: "inspired" }],
        status: "suggested",
        source: "https://x.com/levelsio/status/1",
      });
      const ready = yield* store.byStatus("suggested");
      expect(ready.map((r) => r.id)).toEqual([d.id]);
      expect(ready[0]?.source).toBe("https://x.com/levelsio/status/1");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("next free slot skips the slot a queued draft holds", () =>
    Effect.gen(function* () {
      const drafts = yield* DraftStore.DraftStore;
      const slots = yield* SlotStore.SlotStore;
      expect(yield* slots.list).toHaveLength(3);
      const now = yield* DateTime.now;
      const first = yield* slots.nextFree(now);
      expect(first).not.toBeNull();
      const d = yield* drafts.create({ blocks: [{ text: "x" }] });
      yield* drafts.setOutcome(d.id, { status: "queued", scheduledAt: first });
      const second = yield* slots.nextFree(now);
      expect(second).not.toBe(first);
      expect(second! > first!).toBe(true);
      // Due only once the slot time has passed.
      expect(yield* drafts.due(DateTime.formatIso(now))).toHaveLength(0);
      expect(yield* drafts.due(second!)).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );
});
