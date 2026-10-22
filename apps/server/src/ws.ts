import { WS_METHODS, WS_PATH, WsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import * as ClaudeAgent from "./agent/ClaudeAgent.ts";
import * as DesktopChannel from "./agent/DesktopChannel.ts";
import * as ThreadStore from "./agent/ThreadStore.ts";
import * as ServerConfig from "./config.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";

/** Handlers decode, call one service method, and map errors. Nothing else. */
const layerHandlers = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const observations = yield* ObservationStore.ObservationStore;
    const threads = yield* ThreadStore.ThreadStore;
    const agent = yield* ClaudeAgent.ClaudeAgent;
    const desktop = yield* DesktopChannel.DesktopChannel;
    return WsRpcGroup.of({
      [WS_METHODS.serverInfo]: () =>
        Effect.succeed({
          name: "xtend" as const,
          version: config.version,
          baseDir: config.baseDir,
        }),
      [WS_METHODS.observationsRecord]: (batch) => observations.record(batch),
      [WS_METHODS.observationsListRecent]: (input) => observations.listRecent(input),
      [WS_METHODS.threadsList]: () => Effect.map(threads.list, (list) => ({ threads: list })),
      [WS_METHODS.threadsCreate]: (input) => threads.create(input.title),
      [WS_METHODS.threadsSend]: (input) => Effect.as(agent.send(input.threadId, input.text), {}),
      [WS_METHODS.threadsEvents]: (input) =>
        Effect.map(threads.events(input.threadId, input.afterSequence ?? 0), (events) => ({
          events,
        })),
      [WS_METHODS.threadsSubscribe]: (input) =>
        threads.subscribe(input.threadId, input.afterSequence ?? 0),
      [WS_METHODS.desktopSubscribeCommands]: () => desktop.commands,
      [WS_METHODS.desktopCompleteCommand]: (result) => Effect.as(desktop.complete(result), {}),
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
