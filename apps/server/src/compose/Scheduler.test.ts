import { describe, expect, it } from "@effect/vitest";
import { XApiError } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import type * as XClient from "../x/XClient.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as Scheduler from "./Scheduler.ts";
import * as SessionPosting from "./SessionPosting.ts";
import * as SlotStore from "./SlotStore.ts";
import { articlesStub, desktopStub } from "./testStubs.ts";

// Records createPost calls; fails when the text contains "boom" and dies on "crash".
const calls: Array<XClient.CreatePostInput> = [];
const xStub = xClientStub({
  createPost: (input) =>
    Effect.gen(function* () {
      if (input.text.includes("crash")) return yield* Effect.die("client bug");
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
});

const layerTest = Scheduler.layerService.pipe(
  Layer.provideMerge(Publisher.layer),
  Layer.provideMerge(
    Layer.mergeAll(DraftStore.layer, SessionPosting.layer, SlotStore.layer, articlesStub),
  ),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      xStub,
      TokenCipher.layerTest,
      Events.layer,
      desktopStub([], () => Effect.die("no desktop in this test")),
    ),
  ),
);

const past = "2026-01-01T00:00:00.000Z";

describe("Scheduler", () => {
  // it.live: the backoff compares against the real clock, not the TestClock at epoch 0.
  it.live("posts due threads as replies and retries failures with backoff", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;

      const ok = yield* drafts.create({ blocks: [{ text: "one" }, { text: "two" }] });
      yield* drafts.reschedule(ok.id, past);
      const bad = yield* drafts.create({ blocks: [{ text: "boom" }] });
      yield* drafts.reschedule(bad.id, past);
      const future = yield* drafts.create({ blocks: [{ text: "later" }] });
      yield* drafts.reschedule(future.id, "2999-01-01T00:00:00.000Z");

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

      // Queued again by the user, it gets the full set of retries back.
      yield* drafts.reschedule(bad.id, past);
      yield* scheduler.tick;
      const requeued = yield* drafts.get(bad.id);
      expect(requeued.status).toBe("queued");
      expect(requeued.attempts).toBe(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a draft unscheduled or moved while the tick posts another stays put", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;
      // A thread with a pause between its posts holds the tick while the user acts.
      const slow = yield* drafts.create({
        blocks: [{ text: "slow 1" }, { text: "slow 2" }],
        threadDelaySeconds: 1,
      });
      yield* drafts.reschedule(slow.id, past);
      const unscheduled = yield* drafts.create({ blocks: [{ text: "not now" }] });
      yield* drafts.reschedule(unscheduled.id, "2026-01-01T00:01:00.000Z");
      const moved = yield* drafts.create({ blocks: [{ text: "next week" }] });
      yield* drafts.reschedule(moved.id, "2026-01-01T00:02:00.000Z");

      const tick = yield* Effect.forkChild(scheduler.tick);
      while (calls.length === 0) yield* Effect.sleep("5 millis");
      yield* drafts.reschedule(unscheduled.id, null);
      yield* drafts.reschedule(moved.id, "2999-01-01T00:00:00.000Z");
      yield* Fiber.join(tick);

      expect(calls.map((c) => c.text)).toEqual(["slow 1", "slow 2"]);
      expect((yield* drafts.get(unscheduled.id)).status).toBe("draft");
      expect((yield* drafts.get(moved.id)).status).toBe("queued");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("posts only the current account's queue", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;
      const sql = yield* SqlClient.SqlClient;
      const switchTo = (id: number) =>
        sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`;
      yield* switchTo(2);
      const theirs = yield* drafts.create({ blocks: [{ text: "second account" }] });
      yield* drafts.reschedule(theirs.id, past);
      yield* switchTo(1);

      expect(yield* scheduler.tick).toEqual([]);
      expect((yield* drafts.get(theirs.id)).status).toBe("queued");
      yield* switchTo(2);
      expect((yield* scheduler.tick).map((d) => d.status)).toEqual(["posted"]);
      expect(calls.map((c) => c.text)).toEqual(["second account"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a draft that crashes the publisher does not hold back the drafts due after it", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;
      const broken = yield* drafts.create({ blocks: [{ text: "crash" }] });
      yield* drafts.reschedule(broken.id, past);
      const next = yield* drafts.create({ blocks: [{ text: "fine" }] });
      yield* drafts.reschedule(next.id, "2026-01-01T00:05:00.000Z");

      yield* scheduler.tick;
      expect((yield* drafts.get(next.id)).status).toBe("posted");
      // Not left in `posting`, where it would sit until a restart.
      expect((yield* drafts.get(broken.id)).status).toBe("failed");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a restart mid-thread leaves it failed with what went out, for the user to resume", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const scheduler = yield* Scheduler.Scheduler;
      const d = yield* drafts.create({ blocks: [{ text: "one" }, { text: "two" }] });
      yield* drafts.reschedule(d.id, past);
      expect(yield* drafts.claim(d.id)).toBe(true);
      yield* drafts.setOutcome(d.id, { postIds: ["1"] });

      // What the service does on start, before its first tick.
      yield* drafts.failInterrupted;
      yield* scheduler.tick;
      const after = yield* drafts.get(d.id);
      expect(after.status).toBe("failed");
      expect(after.postIds).toEqual(["1"]);
      expect(after.error).toContain("may already be on X");
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("schedule stores any ISO time as UTC, so an offset time falls due on time", () =>
    Effect.gen(function* () {
      const drafts = yield* DraftStore.DraftStore;
      const d = yield* drafts.create({ blocks: [{ text: "x" }] });
      const queued = yield* drafts.reschedule(d.id, "2026-10-23T10:00:00+06:00");
      expect(queued.scheduledAt).toBe("2026-10-23T04:00:00.000Z");
      expect(yield* drafts.due("2026-10-23T03:59:59.000Z")).toHaveLength(0);
      expect(yield* drafts.due("2026-10-23T04:00:00.000Z")).toHaveLength(1);
      expect((yield* Effect.result(drafts.reschedule(d.id, "tomorrow")))._tag).toBe("Failure");
      expect((yield* drafts.get(d.id)).scheduledAt).toBe("2026-10-23T04:00:00.000Z");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("queue, schedule, skip and unschedule leave a posted draft alone", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const scheduler = yield* Scheduler.Scheduler;
      const d = yield* drafts.create({ blocks: [{ text: "done" }] });
      yield* publisher.post(d.id, { purpose: "compose.postNow", retry: false });
      for (const attempt of [
        scheduler.queue(d.id),
        scheduler.skip(d.id),
        drafts.reschedule(d.id, past),
        drafts.reschedule(d.id, null),
      ])
        expect((yield* Effect.result(attempt))._tag).toBe("Failure");
      const after = yield* drafts.get(d.id);
      expect(after.status).toBe("posted");
      // Requeued, the scheduler would have claimed it again.
      yield* scheduler.tick;
      expect(calls).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("queue fills slots in order, skip moves past the current one", () =>
    Effect.gen(function* () {
      const drafts = yield* DraftStore.DraftStore;
      const slots = yield* SlotStore.SlotStore;
      const scheduler = yield* Scheduler.Scheduler;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ timeZone: "UTC" });
      // Two slots a day: 09:00 and 18:00.
      yield* slots.replace([
        { weekdayMask: 127, minuteOfDay: 540 },
        { weekdayMask: 127, minuteOfDay: 1080 },
      ]);
      const firstFree = yield* slots.nextFree(yield* DateTime.now);
      const first = yield* drafts.create({ blocks: [{ text: "a" }] });
      const second = yield* drafts.create({ blocks: [{ text: "b" }] });
      // Two Queue clicks at once.
      const [a, b] = yield* Effect.all([scheduler.queue(first.id), scheduler.queue(second.id)], {
        concurrency: "unbounded",
      });
      expect([a.scheduledAt, b.scheduledAt]).toContain(firstFree);
      expect(a.scheduledAt).not.toBe(b.scheduledAt);
      // Skipping the earlier one jumps over the later one's slot, which it keeps.
      const [early, late] = a.scheduledAt! < b.scheduledAt! ? [a, b] : [b, a];
      const skipped = yield* scheduler.skip(early.id);
      expect(skipped.scheduledAt! > late.scheduledAt!).toBe(true);
      expect((yield* drafts.get(late.id)).scheduledAt).toBe(late.scheduledAt);

      // A draft whose time is long gone skips to a slot still ahead, not the next past one.
      const stale = yield* drafts.create({ blocks: [{ text: "c" }] });
      yield* drafts.reschedule(stale.id, past);
      const ahead = yield* scheduler.skip(stale.id);
      expect(ahead.scheduledAt! > DateTime.formatIso(yield* DateTime.now)).toBe(true);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("one weekly slot still finds room months out", () =>
    Effect.gen(function* () {
      const drafts = yield* DraftStore.DraftStore;
      const slots = yield* SlotStore.SlotStore;
      const scheduler = yield* Scheduler.Scheduler;
      // Sundays at 10:00 only.
      yield* slots.replace([{ weekdayMask: 1, minuteOfDay: 600 }]);
      const times: Array<string> = [];
      for (let i = 0; i < 12; i++) {
        const d = yield* drafts.create({ blocks: [{ text: `week ${i}` }] });
        times.push((yield* scheduler.queue(d.id)).scheduledAt!);
      }
      expect(new Set(times).size).toBe(12);
      expect([...times].sort()).toEqual(times);
    }).pipe(Effect.provide(layerTest)),
  );
});
