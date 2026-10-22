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

export const WS_PATH = "/ws";

export const WS_METHODS = {
  serverInfo: "server.info",
  observationsRecord: "observations.record",
  observationsListRecent: "observations.listRecent",
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

export const WsRpcGroup = RpcGroup.make(
  ServerInfoRpc,
  ObservationsRecordRpc,
  ObservationsListRecentRpc,
);
