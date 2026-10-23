import { CoreRpcGroup, Costs_METHODS, WS_METHODS, WS_PATH, WsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

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

import * as ServiceAuth from "./auth/ServiceAuth.ts";
import * as ServerConfig from "./config.ts";
import * as Costs from "./costs/Costs.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as SettingsStore from "./settings/SettingsStore.ts";

/** Handlers decode, call one service method, and map errors. Nothing else. */
const layerCoreHandlers = CoreRpcGroup.toLayer(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const observations = yield* ObservationStore.ObservationStore;
    const settings = yield* SettingsStore.SettingsStore;
    const costs = yield* Costs.Costs;
    return CoreRpcGroup.of({
      [WS_METHODS.serverInfo]: () =>
        Effect.succeed({
          name: "xtend" as const,
          version: config.version,
          baseDir: config.baseDir,
          host: config.host,
          supervisor: config.supervisor,
        }),
      [WS_METHODS.observationsRecord]: (batch) => observations.record(batch),
      [WS_METHODS.observationsListRecent]: (input) => observations.listRecent(input),
      [WS_METHODS.settingsGet]: () => settings.get,
      [WS_METHODS.settingsUpdate]: (patch) => settings.update(patch),
      [WS_METHODS.spendSummary]: () => settings.spendSummary,
      [Costs_METHODS.quote]: ({ actions }) => costs.quote(actions),
    });
  }),
);

/** Every area's handler layer, merged. Add a line here when a new RpcGroup joins WsRpcGroup. The HTTP bridge dispatches into the same layer. */
export const layerHandlers = Layer.mergeAll(
  layerCoreHandlers,
  ComposeHandlers.layerHandlers,
  PlanHandlers.layerHandlers,
  AnalyzeHandlers.layerHandlers,
  ScoresHandlers.layerHandlers,
  LibraryHandlers.layerHandlers,
  EngageHandlers.layerHandlers,
  LeadsHandlers.layerHandlers,
  AutomateHandlers.layerHandlers,
  DesktopHandlers.layerHandlers,
  EventsHandlers.layerHandlers,
  AccountsHandlers.layerHandlers,
);

export const layerRoute = HttpRouter.add(
  "GET",
  WS_PATH,
  ServiceAuth.guarded(
    Effect.gen(function* () {
      const httpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup).pipe(
        Effect.provide(layerHandlers.pipe(Layer.provideMerge(RpcSerialization.layerJson))),
      );
      return yield* httpEffect;
    }),
  ),
);
