import { Plan_METHODS, type SlotInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

export const slotsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return (yield* client[Plan_METHODS.slotsGet]({})).slots;
  }),
);

export const setSlotsAtom = clientRuntime.fn<ReadonlyArray<SlotInput>>()(
  Effect.fnUntraced(function* (slots) {
    const client = yield* XtendClient;
    return yield* client[Plan_METHODS.slotsSet]({ slots });
  }),
);

export const heatmapAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Plan_METHODS.heatmap]({});
  }),
);

export const readyAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return (yield* client[Plan_METHODS.ready]({})).drafts;
  }),
);

/** Drafts in a month; key is "YYYY-MM" so the calendar refetches when the user moves. */
export const calendarAtom = Atom.family((month: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      const from = new Date(`${month}-01T00:00:00`);
      const to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      return (yield* client[Plan_METHODS.calendar]({
        from: from.toISOString(),
        to: to.toISOString(),
      })).drafts;
    }),
  ),
);

export const runsAtom = Atom.family((id: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return (yield* client[Plan_METHODS.runsList]({ id })).runs;
    }),
  ),
);

const draftAction = (method: "plan.queue" | "plan.unschedule" | "plan.skip" | "plan.runNow") =>
  clientRuntime.fn<string>()(
    Effect.fnUntraced(function* (id) {
      const client = yield* XtendClient;
      return yield* client[method]({ id });
    }),
  );

export const queueAtom = draftAction(Plan_METHODS.queue);
export const unscheduleAtom = draftAction(Plan_METHODS.unschedule);
export const skipAtom = draftAction(Plan_METHODS.skip);
export const runNowAtom = draftAction(Plan_METHODS.runNow);

export const scheduleAtom = clientRuntime.fn<{ readonly id: string; readonly at: string }>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Plan_METHODS.schedule](input);
  }),
);
