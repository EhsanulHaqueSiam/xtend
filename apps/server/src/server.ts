// @effect-diagnostics nodeBuiltinImport:off -- Effect wraps the raw Node server.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as ClaudeAgent from "./agent/ClaudeAgent.ts";
import * as DesktopChannel from "./agent/DesktopChannel.ts";
import * as ThreadStore from "./agent/ThreadStore.ts";
import * as ServerConfig from "./config.ts";
import * as ServerHttp from "./http.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import * as Ws from "./ws.ts";

const layerHttpServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return NodeHttpServer.layer(() => NodeHttp.createServer(), {
      host: config.host,
      port: config.port,
    });
  }),
);

const layerRoutes = Layer.mergeAll(
  ServerHttp.layerHealthRoute,
  ServerHttp.layerObservationsRoute,
  Ws.layerRoute,
  ServerHttp.layerWebRoute,
);

const layerServices = ClaudeAgent.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(ThreadStore.layer, DesktopChannel.layer, ObservationStore.layer),
  ),
  Layer.provideMerge(Sqlite.layerConfig),
);

const layerApplication = HttpRouter.serve(layerRoutes).pipe(
  Layer.tap(() =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      yield* Effect.log(`xtend service listening on http://${config.host}:${config.port}`);
    }),
  ),
  Layer.provideMerge(layerServices),
  Layer.provideMerge(layerHttpServer),
  Layer.provideMerge(NodeServices.layer),
);

export const runServer = Layer.launch(layerApplication);
