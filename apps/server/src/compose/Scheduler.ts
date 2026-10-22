import { ComposeError, type Draft } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";

const TICK = "30 seconds";

export class Scheduler extends Context.Service<
  Scheduler,
  {
    /** Posts every queued draft whose time has passed. Returns the drafts it touched. */
    readonly tick: Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    /** Posts one queued draft now, with the scheduler's retry rules. */
    readonly runNow: (id: string) => Effect.Effect<Draft, ComposeError>;
  }
>()("xtend/compose/Scheduler") {}

const make = Effect.gen(function* () {
  const drafts = yield* DraftStore.DraftStore;
  const publisher = yield* Publisher.Publisher;

  const tick = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const due = yield* drafts.due(now);
    return yield* Effect.forEach(due, (d) =>
      publisher.post(d, { purpose: "plan.scheduler", retry: true }),
    );
  });

  const runNow = Effect.fn("Scheduler.runNow")(function* (id: string) {
    const draft = yield* drafts.get(id);
    if (draft.status !== "queued")
      return yield* new ComposeError({ operation: "runNow", detail: `Draft is ${draft.status}` });
    return yield* publisher.post(draft, { purpose: "plan.runNow", retry: true });
  });

  return Scheduler.of({ tick, runNow });
});

export const layerService = Layer.effect(Scheduler, make);

// One fiber for the service's lifetime; a failing tick is logged and the next one still runs.
const layerLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    yield* scheduler.tick.pipe(
      Effect.catch((e) => Effect.logWarning("Scheduler tick failed", e)),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
);

export const layer = Layer.merge(layerService, layerLoop.pipe(Layer.provide(layerService)));
