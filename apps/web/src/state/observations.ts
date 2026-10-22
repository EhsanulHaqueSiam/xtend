import { WS_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const recentPostsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.observationsListRecent]({ limit: 100 });
  }),
);

export const serverInfoAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.serverInfo]({});
  }),
);
