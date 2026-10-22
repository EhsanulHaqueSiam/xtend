import { WS_METHODS, WS_PATH, WsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import * as ServerConfig from "./config.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";

/** Handlers decode, call one service method, and map errors. Nothing else. */
const layerHandlers = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const observations = yield* ObservationStore.ObservationStore;
    return WsRpcGroup.of({
      [WS_METHODS.serverInfo]: () =>
        Effect.succeed({
          name: "xtend" as const,
          version: config.version,
          baseDir: config.baseDir,
        }),
      [WS_METHODS.observationsRecord]: (batch) => observations.record(batch),
      [WS_METHODS.observationsListRecent]: (input) => observations.listRecent(input),
    });
  }),
);

export const layerRoute = HttpRouter.add(
  "GET",
  WS_PATH,
  Effect.gen(function* () {
    const httpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup).pipe(
      Effect.provide(layerHandlers.pipe(Layer.provideMerge(RpcSerialization.layerJson))),
    );
    return yield* httpEffect;
  }),
);
