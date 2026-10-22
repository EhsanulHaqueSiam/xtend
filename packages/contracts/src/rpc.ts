import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  ObservationBatch,
  ObservationListRecentInput,
  ObservationListRecentResult,
  ObservationRecordResult,
  ObservationStoreError,
} from "./observation.ts";
import { ServerInfo } from "./server.ts";
import { ComposeRpcGroup } from "./compose.ts";
import { PlanRpcGroup } from "./plan.ts";
import { AnalyzeRpcGroup } from "./analyze.ts";
import { ScoresRpcGroup } from "./scores.ts";
import { LibraryRpcGroup } from "./library.ts";
import { EngageRpcGroup } from "./engage.ts";
import { LeadsRpcGroup } from "./leads.ts";
import { AutomateRpcGroup } from "./automate.ts";
import { DesktopRpcGroup } from "./desktop.ts";
import { EventsRpcGroup } from "./events.ts";

import { CostAction, CostQuoteResult, Costs_METHODS } from "./costs.ts";
import { Settings, SettingsError, SettingsUpdate, SpendSummary } from "./settings.ts";

export const WS_PATH = "/ws";

export const WS_METHODS = {
  serverInfo: "server.info",
  observationsRecord: "observations.record",
  observationsListRecent: "observations.listRecent",
  settingsGet: "settings.get",
  settingsUpdate: "settings.update",
  spendSummary: "spend.summary",
} as const;

const ServerInfoRpc = Rpc.make(WS_METHODS.serverInfo, {
  payload: Schema.Struct({}),
  success: ServerInfo,
});

const ObservationsRecordRpc = Rpc.make(WS_METHODS.observationsRecord, {
  payload: ObservationBatch,
  success: ObservationRecordResult,
  error: ObservationStoreError,
});

const ObservationsListRecentRpc = Rpc.make(WS_METHODS.observationsListRecent, {
  payload: ObservationListRecentInput,
  success: ObservationListRecentResult,
  error: ObservationStoreError,
});

const SettingsGetRpc = Rpc.make(WS_METHODS.settingsGet, {
  payload: Schema.Struct({}),
  success: Settings,
  error: SettingsError,
});

const SettingsUpdateRpc = Rpc.make(WS_METHODS.settingsUpdate, {
  payload: SettingsUpdate,
  success: Settings,
  error: SettingsError,
});

const SpendSummaryRpc = Rpc.make(WS_METHODS.spendSummary, {
  payload: Schema.Struct({}),
  success: SpendSummary,
  error: SettingsError,
});

/** The rate card plus a priced quote per action; the only place a client learns a price. */
const CostsQuoteRpc = Rpc.make(Costs_METHODS.quote, {
  payload: Schema.Struct({ actions: Schema.Array(CostAction) }),
  success: CostQuoteResult,
  error: SettingsError,
});

/**
 * Each suite area owns its own RpcGroup in its contract file and is merged
 * here, so adding a screen never edits another screen's handlers.
 */
export const CoreRpcGroup = RpcGroup.make(
  ServerInfoRpc,
  ObservationsRecordRpc,
  ObservationsListRecentRpc,
  SettingsGetRpc,
  SettingsUpdateRpc,
  SpendSummaryRpc,
  CostsQuoteRpc,
);

/** The whole wire surface. Area groups are merged in as arguments here. */
export const WsRpcGroup = CoreRpcGroup.merge(
  ComposeRpcGroup,
  PlanRpcGroup,
  AnalyzeRpcGroup,
  ScoresRpcGroup,
  LibraryRpcGroup,
  EngageRpcGroup,
  LeadsRpcGroup,
  AutomateRpcGroup,
  DesktopRpcGroup,
  EventsRpcGroup,
);
