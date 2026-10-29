import { Pool_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

/** The pool's hot posts and rising terms. Free; the worker caches a minute. */
export const poolTrendsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Pool_METHODS.trends]({});
  }),
);
