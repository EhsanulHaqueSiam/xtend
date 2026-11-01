import { ComposeError, type Draft } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";

import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as SlotStore from "./SlotStore.ts";
import * as Metrics from "../observability/Metrics.ts";

const TICK = "30 seconds";

export class Scheduler extends Context.Service<
  Scheduler,
  {
    /** Posts every queued draft whose time has passed. Returns the drafts it posted or requeued. */
    readonly tick: Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    /** Posts one queued draft now, with the scheduler's retry rules. */
    readonly runNow: (id: string) => Effect.Effect<Draft, ComposeError>;
    /** Puts the draft in the next slot no queued draft holds. */
    readonly queue: (id: string) => Effect.Effect<Draft, ComposeError>;
    /** Moves the draft to the next free slot after its current time, or after now once that has passed. */
    readonly skip: (id: string) => Effect.Effect<Draft, ComposeError>;
  }
>()("xtend/compose/Scheduler") {}

const make = Effect.gen(function* () {
  const drafts = yield* DraftStore.DraftStore;
  const publisher = yield* Publisher.Publisher;
  const slots = yield* SlotStore.SlotStore;
  // Finding a free slot and taking it are two steps; two queue clicks must not land on one slot.
  const slotLock = yield* Semaphore.make(1);

  const tick = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const due = yield* drafts.due(now);
    // One draft's failure, even a defect, or a Post now that claimed it first must not hold back the rest.
    const touched = yield* Effect.forEach(due, (d) =>
      publisher.post(d.id, { purpose: "plan.scheduler", retry: true, due: now }).pipe(
        Effect.map((posted) => [posted]),
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning("Scheduler skipped a due draft", cause), []),
        ),
      ),
    );
    return touched.flat();
  });

  const runNow = Effect.fn("Scheduler.runNow")(function* (id: string) {
    const draft = yield* drafts.get(id);
    if (draft.status !== "queued")
      return yield* new ComposeError({ operation: "runNow", detail: `Draft is ${draft.status}` });
    return yield* publisher.post(id, { purpose: "plan.runNow", retry: true, clicked: true });
  });

  const queueAfter = (id: string, after: DateTime.Utc) =>
    Semaphore.withPermit(slotLock)(
      Effect.gen(function* () {
        const at = yield* slots.nextFree(after);
        if (at === null)
          return yield* new ComposeError({ operation: "queue", detail: "No posting slots set" });
        return yield* drafts.reschedule(id, at);
      }),
    );

  const queue = Effect.fn("Scheduler.queue")(function* (id: string) {
    return yield* queueAfter(id, yield* DateTime.now);
  });

  const skip = Effect.fn("Scheduler.skip")(function* (id: string) {
    const d = yield* drafts.get(id);
    const now = yield* DateTime.now;
    // The slot after a time long gone (a failed or overdue draft) is past too and would post at once.
    return yield* queueAfter(
      id,
      d.scheduledAt === null ? now : DateTime.max(now, DateTime.makeUnsafe(d.scheduledAt)),
    );
  });

  return Scheduler.of({ tick, runNow, queue, skip });
});

export const layerService = Layer.effect(Scheduler, make);

// One fiber for the service's lifetime; a failing tick is logged and the next one still runs.
// Each tick runs on its own fiber so a thread with long delays between posts cannot hold back
// drafts that fall due meanwhile; the publisher's claim keeps overlapping ticks from double-posting.
const layerLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    const scope = yield* Effect.scope;
    yield* (yield* DraftStore.DraftStore).failInterrupted;
    yield* scheduler.tick.pipe(
      Metrics.withJobMetrics("compose.scheduler"),
      Effect.catch((e) => Effect.logWarning("Scheduler tick failed", e)),
      Effect.forkIn(scope),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
);

export const layer = Layer.merge(layerService, layerLoop.pipe(Layer.provide(layerService)));
