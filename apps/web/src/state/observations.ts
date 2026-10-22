import { WS_METHODS } from "@corvid/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, CorvidClient } from "../rpc/client";

export const recentPostsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* CorvidClient;
    return yield* client[WS_METHODS.observationsListRecent]({ limit: 100 });
  }),
);

export const serverInfoAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* CorvidClient;
    return yield* client[WS_METHODS.serverInfo]({});
  }),
);
