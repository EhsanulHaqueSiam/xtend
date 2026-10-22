import { Analyze_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const analyzeDataAtom = clientRuntime.atom(
  Effect.gen(function* () {
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

export const engagersAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.engagers]({});
  }),
);

/** Paid (model call) unless the service has the result cached for the same posts. */
export const themesAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.themes]({});
  }),
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

export const askAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (question) {
    const client = yield* XtendClient;
    return yield* client[Analyze_METHODS.ask]({ question });
  }),
);
