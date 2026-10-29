import { Analyze_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/** Moves when the service adopts the signed-in session's handle; ordinary observations leave it alone. */
const handleAdoptedAtom = Atom.make(
  (get) =>
    get(eventsOfTypeAtom("observation_recorded")).filter((e) => "handleAdopted" in e.payload)
      .length,
);

/** Refetches when the handle is adopted, so signing in to X beside the screen fills it in. */
export const analyzeDataAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(handleAdoptedAtom);
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.data]({});
  }),
);

/** Paid: fetches the profile and up to 100 own posts. Refresh analyzeDataAtom after it resolves. */
export const refreshAnalyzeAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.refresh]({});
  }),
);

/** Paid: X's private metrics for the last 30 days of own posts. Refresh analyzeDataAtom after it resolves. */
export const refreshNonPublicAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.refreshNonPublic]({});
  }),
);

export const engagersAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.engagers]({});
  }),
);

/**
 * A model call on the user's login unless the service has the result cached for the same posts. Kept alive, as is
 * askAtom: the click does not await either, so leaving the tab would interrupt the call.
 */
export const themesAtom = Atom.keepAlive(
  clientRuntime.fn<void>()(
    Effect.fnUntraced(function* () {
      const client = yield* XtendClient;
      return yield* client[Analyze_METHODS.themes]({});
    }),
  ),
);

export const competitorsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.competitors]({});
  }),
);

export const fetchCompetitorAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (handle) {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.competitorFetch]({ handle });
  }),
);

export const askAtom = Atom.keepAlive(
  clientRuntime.fn<string>()(
    Effect.fnUntraced(function* (question) {
      const client = yield* XtendClient;
      return yield* client[Analyze_METHODS.ask]({ question });
    }),
  ),
);
