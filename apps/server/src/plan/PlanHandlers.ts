import { ComposeError, Plan_METHODS, PlanRpcGroup } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BestTime from "../compose/BestTime.ts";
import * as DraftStore from "../compose/DraftStore.ts";
import * as Scheduler from "../compose/Scheduler.ts";
import * as SlotStore from "../compose/SlotStore.ts";

/** Plan shares Compose's services (ComposeHandlers.layer); nothing extra to build here. */
export const layer = Layer.empty;

/** RPC handlers for PlanRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = PlanRpcGroup.toLayer(
  Effect.gen(function* () {
    const drafts = yield* DraftStore.DraftStore;
    const slots = yield* SlotStore.SlotStore;
    const scheduler = yield* Scheduler.Scheduler;
    const bestTime = yield* BestTime.BestTime;

    const queueAfter = Effect.fn("Plan.queueAfter")(function* (id: string, after: DateTime.Utc) {
      const at = yield* slots.nextFree(after);
      if (at === null)
        return yield* new ComposeError({ operation: "queue", detail: "No posting slots set" });
      return yield* drafts.setOutcome(id, { status: "queued", scheduledAt: at, error: null });
    });

    return PlanRpcGroup.of({
      [Plan_METHODS.slotsGet]: () => Effect.map(slots.list, (list) => ({ slots: list })),
      [Plan_METHODS.slotsSet]: (input) =>
        Effect.map(slots.replace(input.slots), (list) => ({ slots: list })),
      [Plan_METHODS.queue]: ({ id }) => Effect.flatMap(DateTime.now, (now) => queueAfter(id, now)),
      [Plan_METHODS.schedule]: ({ id, at }) =>
        drafts.setOutcome(id, { status: "queued", scheduledAt: at, error: null }),
      [Plan_METHODS.unschedule]: ({ id }) =>
        drafts.setOutcome(id, { status: "draft", scheduledAt: null }),
      [Plan_METHODS.skip]: ({ id }) =>
        Effect.flatMap(drafts.get(id), (d) =>
          d.scheduledAt === null
            ? Effect.flatMap(DateTime.now, (now) => queueAfter(id, now))
            : queueAfter(id, DateTime.makeUnsafe(d.scheduledAt)),
        ),
      [Plan_METHODS.runNow]: ({ id }) => scheduler.runNow(id),
      [Plan_METHODS.runsList]: ({ id }) => Effect.map(drafts.runs(id), (runs) => ({ runs })),
      [Plan_METHODS.calendar]: ({ from, to }) =>
        Effect.map(drafts.inRange(from, to), (list) => ({ drafts: list })),
      [Plan_METHODS.heatmap]: () => bestTime.heatmap,
      [Plan_METHODS.ready]: () =>
        Effect.map(drafts.byStatus("suggested"), (list) => ({ drafts: list })),
    });
  }),
);
