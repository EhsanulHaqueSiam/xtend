import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as DraftStore from "./DraftStore.ts";
import * as SlotStore from "./SlotStore.ts";

const layerTest = Layer.mergeAll(DraftStore.layer, SlotStore.layer).pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest, Events.layer)),
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

  it.effect("media rows follow their block, keep order, and go with the draft", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const d = yield* store.create({
        blocks: [{ text: "a" }, { text: "b", replySettings: "following" }],
        quoteUrl: "https://x.com/levelsio/status/1",
      });
      expect(d.blocks[1]?.replySettings).toBe("following");
      expect(d.quoteUrl).toBe("https://x.com/levelsio/status/1");
      yield* store.mediaInsert(d.id, {
        id: "m1",
        blockIndex: 0,
        path: "/m/1.png",
        kind: "image",
        alt: "",
      });
      const two = yield* store.mediaInsert(d.id, {
        id: "m2",
        blockIndex: 0,
        path: "/m/2.png",
        kind: "image",
        alt: "",
      });
      expect(two.media.map((m) => [m.id, m.position])).toEqual([
        ["m1", 0],
        ["m2", 1],
      ]);
      // The editor reorders and captions; the list comes back sorted by block then position.
      const moved = yield* store.update(d.id, {
        media: [
          { id: "m1", blockIndex: 1, alt: "first", position: 0 },
          { id: "m2", blockIndex: 0, alt: "", position: 0 },
        ],
      });
      expect(moved.media.map((m) => [m.id, m.blockIndex, m.alt])).toEqual([
        ["m2", 0, ""],
        ["m1", 1, "first"],
      ]);
      expect(yield* store.mediaRemove(d.id, "m2")).toBe("/m/2.png");
      expect(yield* store.mediaRemove(d.id, "nope")).toBeNull();
      expect((yield* store.list)[0]?.media.map((m) => m.id)).toEqual(["m1"]);
      // A file added after a removal goes after the ones left, never level with one of them.
      yield* store.mediaInsert(d.id, {
        id: "m3",
        blockIndex: 1,
        path: "/m/3.png",
        kind: "image",
        alt: "",
      });
      yield* store.mediaRemove(d.id, "m1");
      yield* store.mediaInsert(d.id, {
        id: "m1b",
        blockIndex: 1,
        path: "/m/4.png",
        kind: "image",
        alt: "",
      });
      expect((yield* store.get(d.id)).media.map((m) => [m.id, m.position])).toEqual([
        ["m3", 1],
        ["m1b", 2],
      ]);
      yield* store.remove(d.id);
      expect(yield* store.mediaRemove(d.id, "m3")).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a long posting history does not push drafts off the list", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const old = yield* store.create({ blocks: [{ text: "started last month" }] });
      yield* TestClock.adjust("1 day");
      for (let i = 0; i < 200; i++) {
        const d = yield* store.create({ blocks: [{ text: `post ${i}` }] });
        yield* store.setOutcome(d.id, { status: "posted", postIds: [String(i + 1)] });
      }
      const list = yield* store.list;
      expect(list).toHaveLength(200);
      expect(list[0]?.id).toBe(old.id);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("media changed on a post already on X starts the thread over", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const image = (id: string, blockIndex: number) =>
        ({ id, blockIndex, path: `/m/${id}.png`, kind: "image", alt: "" }) as const;
      const d = yield* store.create({ blocks: [{ text: "a" }, { text: "b" }, { text: "c" }] });
      // Posts 1 and 2 went out; post 3 failed.
      yield* store.setOutcome(d.id, { status: "failed", postIds: ["1", "2"] });
      expect((yield* store.mediaInsert(d.id, image("on3", 2))).postIds).toEqual(["1", "2"]);
      expect((yield* store.mediaInsert(d.id, image("on1", 0))).postIds).toEqual([]);
      yield* store.setOutcome(d.id, { postIds: ["1", "2"] });
      yield* store.mediaRemove(d.id, "on3");
      expect((yield* store.get(d.id)).postIds).toEqual(["1", "2"]);
      yield* store.mediaRemove(d.id, "on1");
      expect((yield* store.get(d.id)).postIds).toEqual([]);

      // An article's cover is not what it published, so a published article stays published.
      const article = yield* store.create({ kind: "article", title: "T", body: "b" });
      yield* store.setOutcome(article.id, { status: "failed", articleId: "5", postIds: ["77"] });
      const covered = yield* store.mediaInsert(article.id, image("cover", 0));
      expect([covered.articleId, covered.postIds]).toEqual(["5", ["77"]]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("the calendar keeps drafts mid-publish or failed in their slot", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const at = "2026-10-23T09:00:00.000Z";
      const make = (status: "queued" | "failed" | "draft") =>
        Effect.flatMap(store.create({ blocks: [{ text: status }] }), (d) =>
          store.setOutcome(d.id, { status, scheduledAt: at }),
        );
      const queued = yield* make("queued");
      const failed = yield* make("failed");
      yield* make("draft");
      const posting = yield* make("queued");
      expect(yield* store.claim(posting.id)).toBe(true);
      const posted = yield* store.create({ blocks: [{ text: "posted" }] });
      yield* store.setOutcome(posted.id, {
        status: "posted",
        postedAt: "2026-10-23T08:00:00.000Z",
      });

      // The week as a client in Dhaka asks for it: offsets are compared as instants.
      const week = yield* store.inRange("2026-10-23T06:00:00+06:00", "2026-10-30T06:00:00+06:00");
      expect(week.map((d) => d.id).sort()).toEqual(
        [queued.id, failed.id, posting.id, posted.id].sort(),
      );
      expect(yield* store.inRange("2026-10-23T15:00:01+06:00", "2026-10-30T00:00:00Z")).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a draft mid-publish cannot be deleted", () =>
    Effect.gen(function* () {
      const store = yield* DraftStore.DraftStore;
      const d = yield* store.create({ blocks: [{ text: "going out" }] });
      yield* store.mediaInsert(d.id, {
        id: "m",
        blockIndex: 0,
        path: "/m/m.png",
        kind: "image",
        alt: "",
      });
      expect(yield* store.claim(d.id)).toBe(true);
      expect((yield* Effect.flip(store.remove(d.id))).detail).toContain("posting");
      expect((yield* store.get(d.id)).media).toHaveLength(1);
      yield* store.setOutcome(d.id, { status: "failed" });
      yield* store.remove(d.id);
      expect(yield* store.mediaRemove(d.id, "m")).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );
});
