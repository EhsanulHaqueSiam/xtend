import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";
import { ComposeError, Draft, DraftList } from "./compose.ts";

/** Plan screen contracts: slots, queue runs, calendar and best time. Owned by the plan area. */

/** A posting slot in the service's local time. Bit n of weekdayMask is weekday n (0 = Sunday). */
export const SlotInput = Schema.Struct({
  weekdayMask: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 127 })),
  minuteOfDay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1439 })),
});
export type SlotInput = typeof SlotInput.Type;

export const Slot = Schema.Struct({ id: Schema.Int, ...SlotInput.fields });
export type Slot = typeof Slot.Type;

export const SlotList = Schema.Struct({ slots: Schema.Array(Slot) });
export type SlotList = typeof SlotList.Type;

/** One scheduler attempt, success or not. */
export const QueueRun = Schema.Struct({
  id: Schema.Int,
  draftId: Schema.String,
  at: IsoDateTime,
  attempt: NonNegativeInt,
  ok: Schema.Boolean,
  detail: Schema.String,
});
export type QueueRun = typeof QueueRun.Type;

/** 7 x 24 view-weighted post counts (index = weekday * 24 + hour, local time). */
export const Heatmap = Schema.Struct({
  cells: Schema.Array(Schema.Number),
  posts: NonNegativeInt,
  /** Top hours by weighted views, best first. Empty until there are 10 observed posts. */
  best: Schema.Array(Schema.Struct({ weekday: Schema.Int, hour: Schema.Int })),
});
export type Heatmap = typeof Heatmap.Type;

export const Plan_METHODS = {
  slotsGet: "plan.slotsGet",
  slotsSet: "plan.slotsSet",
  queue: "plan.queue",
  schedule: "plan.schedule",
  unschedule: "plan.unschedule",
  skip: "plan.skip",
  runNow: "plan.runNow",
  runsList: "plan.runsList",
  calendar: "plan.calendar",
  heatmap: "plan.heatmap",
  ready: "plan.ready",
} as const;

const DraftId = Schema.Struct({ id: Schema.String });

export const PlanRpcGroup = RpcGroup.make(
  Rpc.make(Plan_METHODS.slotsGet, {
    payload: Schema.Struct({}),
    success: SlotList,
    error: ComposeError,
  }),
  Rpc.make(Plan_METHODS.slotsSet, {
    payload: Schema.Struct({ slots: Schema.Array(SlotInput) }),
    success: SlotList,
    error: ComposeError,
  }),
  /** Puts the draft in the next slot without a queued draft. */
  Rpc.make(Plan_METHODS.queue, { payload: DraftId, success: Draft, error: ComposeError }),
  Rpc.make(Plan_METHODS.schedule, {
    payload: Schema.Struct({ ...DraftId.fields, at: IsoDateTime }),
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Plan_METHODS.unschedule, { payload: DraftId, success: Draft, error: ComposeError }),
  /** Moves the draft to the next free slot after its current one. */
  Rpc.make(Plan_METHODS.skip, { payload: DraftId, success: Draft, error: ComposeError }),
  Rpc.make(Plan_METHODS.runNow, { payload: DraftId, success: Draft, error: ComposeError }),
  Rpc.make(Plan_METHODS.runsList, {
    payload: DraftId,
    success: Schema.Struct({ runs: Schema.Array(QueueRun) }),
    error: ComposeError,
  }),
  /** Queued and posted drafts whose scheduled or posted time falls in [from, to). */
  Rpc.make(Plan_METHODS.calendar, {
    payload: Schema.Struct({ from: IsoDateTime, to: IsoDateTime }),
    success: DraftList,
    error: ComposeError,
  }),
  Rpc.make(Plan_METHODS.heatmap, {
    payload: Schema.Struct({}),
    success: Heatmap,
    error: ComposeError,
  }),
  Rpc.make(Plan_METHODS.ready, {
    payload: Schema.Struct({}),
    success: DraftList,
    error: ComposeError,
  }),
);
