// @effect-diagnostics nodeBuiltinImport:off -- Effect wraps the raw Node server.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";

import * as Assist from "./ai/Assist.ts";
import * as Events from "./events/Events.ts";
import * as ServiceAuth from "./auth/ServiceAuth.ts";
import * as Budget from "./budget/Budget.ts";
import * as Costs from "./costs/Costs.ts";
import * as ComposeHandlers from "./compose/ComposeHandlers.ts";
import * as PlanHandlers from "./plan/PlanHandlers.ts";
import * as AnalyzeHandlers from "./analyze/AnalyzeHandlers.ts";
import * as ScoresHandlers from "./scores/ScoresHandlers.ts";
import * as LibraryHandlers from "./library/LibraryHandlers.ts";
import * as EngageHandlers from "./engage/EngageHandlers.ts";
import * as LeadsHandlers from "./leads/LeadsHandlers.ts";
import * as AutomateHandlers from "./automate/AutomateHandlers.ts";
import * as DesktopHandlers from "./desktop/DesktopHandlers.ts";
import * as EventsHandlers from "./events/EventsHandlers.ts";
import * as AccountsHandlers from "./accounts/AccountsHandlers.ts";
import * as MarksHandlers from "./marks/MarksHandlers.ts";

import * as ServerConfig from "./config.ts";
import * as ServerHttp from "./http.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import * as SettingsStore from "./settings/SettingsStore.ts";
import * as TokenCipher from "./settings/TokenCipher.ts";
import * as XClient from "./x/XClient.ts";
import * as Ws from "./ws.ts";
import * as HttpRpc from "./rpc/HttpRpc.ts";

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
  ServerHttp.layerDevTokenRoute,
  ServerHttp.layerObservationsRoute,
  ServerHttp.layerWebhookRoute,
  Ws.layerRoute,
  HttpRpc.layerRoute,
  ServerHttp.layerWebRoute,
);

// Foundation every area builds on: settings and spend, the X client, the assistant.
// Area layers (compose, analyze, ...) go in layerAreas and may depend on all of these.
const layerFoundation = Layer.mergeAll(Assist.layer, XClient.layer).pipe(
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(Layer.mergeAll(ObservationStore.layer, SettingsStore.layer)),
  Layer.provideMerge(Layer.mergeAll(TokenCipher.layer, ServiceAuth.layer)),
  Layer.provideMerge(Sqlite.layerConfig),
  Layer.provideMerge(NodeHttpClient.layerNodeHttp),
  // Lowest so stores and the budget can publish; it needs nothing itself.
  Layer.provideMerge(Events.layer),
);

const layerAreas = Layer.mergeAll(
  ComposeHandlers.layer,
  PlanHandlers.layer,
  AnalyzeHandlers.layer,
  ScoresHandlers.layer,
  LibraryHandlers.layer,
  EngageHandlers.layer,
  LeadsHandlers.layer,
  AutomateHandlers.layer,
  DesktopHandlers.layer,
  EventsHandlers.layer,
  AccountsHandlers.layer,
  MarksHandlers.layer,
);

const layerServices = Layer.mergeAll(layerAreas, Costs.layer).pipe(
  Layer.provideMerge(layerFoundation),
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
