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

/** Queued and posted drafts in the 7 days from `day` (a local "YYYY-MM-DD"); the calendar refetches when the user moves. */
/** Keyed "fromIso|toIso": the week's bounds are instants the caller computed in the account zone. */
export const calendarAtom = Atom.family((range: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      const [from, to] = range.split("|") as [string, string];
      return (yield* client[Plan_METHODS.calendar]({ from, to })).drafts;
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
