import { Scores_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

/** Stored samples for one handle; never pays. */
export const reportAtom = Atom.family((handle: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Scores_METHODS.report]({ handle });
    }),
  ),
);

/** Paid: up to 5 follower pages plus the profile. Refresh reportAtom(handle) after it resolves. */
export const runScoreAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (handle) {
    const client = yield* XtendClient;
    return yield* client[Scores_METHODS.run]({ handle });
  }),
);

export const watchListAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Scores_METHODS.watchList]({});
  }),
);

export const watchAddAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (handle) {
    const client = yield* XtendClient;
    return yield* client[Scores_METHODS.watchAdd]({ handle });
  }),
);

export const watchRemoveAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (handle) {
    const client = yield* XtendClient;
    return yield* client[Scores_METHODS.watchRemove]({ handle });
  }),
);

export const trendingAtom = Atom.family((country: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Scores_METHODS.trending]({ country });
    }),
  ),
);
