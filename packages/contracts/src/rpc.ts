import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  DesktopCommand,
  DesktopCommandResult,
  ThreadBusyError,
  ThreadEventRecord,
  ThreadNotFoundError,
  ThreadsCreateInput,
  ThreadsEventsInput,
  ThreadsEventsResult,
  ThreadsListResult,
  ThreadsSendInput,
  ThreadStoreError,
  ThreadSummary,
} from "./agent.ts";
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
  threadsList: "threads.list",
  threadsCreate: "threads.create",
  threadsSend: "threads.send",
  threadsEvents: "threads.events",
  threadsSubscribe: "threads.subscribe",
  desktopSubscribeCommands: "desktop.subscribeCommands",
  desktopCompleteCommand: "desktop.completeCommand",
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

const ThreadsListRpc = Rpc.make(WS_METHODS.threadsList, {
  payload: Schema.Struct({}),
  success: ThreadsListResult,
  error: ThreadStoreError,
});

const ThreadsCreateRpc = Rpc.make(WS_METHODS.threadsCreate, {
  payload: ThreadsCreateInput,
  success: ThreadSummary,
  error: ThreadStoreError,
});

const ThreadsSendRpc = Rpc.make(WS_METHODS.threadsSend, {
  payload: ThreadsSendInput,
  success: Schema.Struct({}),
  error: Schema.Union([ThreadStoreError, ThreadNotFoundError, ThreadBusyError]),
});

const ThreadsEventsRpc = Rpc.make(WS_METHODS.threadsEvents, {
  payload: ThreadsEventsInput,
  success: ThreadsEventsResult,
  error: ThreadStoreError,
});

/** Replays history after `afterSequence`, then stays open for live events. */
const ThreadsSubscribeRpc = Rpc.make(WS_METHODS.threadsSubscribe, {
  payload: ThreadsEventsInput,
  success: ThreadEventRecord,
  error: ThreadStoreError,
  stream: true,
});

const DesktopSubscribeCommandsRpc = Rpc.make(WS_METHODS.desktopSubscribeCommands, {
  payload: Schema.Struct({}),
  success: DesktopCommand,
  stream: true,
});

const DesktopCompleteCommandRpc = Rpc.make(WS_METHODS.desktopCompleteCommand, {
  payload: DesktopCommandResult,
  success: Schema.Struct({}),
});

export const WsRpcGroup = RpcGroup.make(
  ServerInfoRpc,
  ObservationsRecordRpc,
  ObservationsListRecentRpc,
  ThreadsListRpc,
  ThreadsCreateRpc,
  ThreadsSendRpc,
  ThreadsEventsRpc,
  ThreadsSubscribeRpc,
  DesktopSubscribeCommandsRpc,
  DesktopCompleteCommandRpc,
);
