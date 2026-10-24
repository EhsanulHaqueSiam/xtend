import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime } from "./baseSchemas.ts";

/**
 * Live events every area publishes and the shell streams to clients. Payloads
 * stay loose on purpose: a consumer that needs detail refetches its own rpc.
 */
export const XtendEventType = Schema.Literals([
  "observation_recorded",
  "draft_status_changed",
  "rule_fired",
  "mention_arrived",
  "lead_found",
  "spend_changed",
  "service_state",
  /** The current account changed; payload `accountId`. Every client reloads onto it. */
  "account_switched",
]);
export type XtendEventType = typeof XtendEventType.Type;

export const XtendEvent = Schema.Struct({
  type: XtendEventType,
  at: IsoDateTime,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
export type XtendEvent = typeof XtendEvent.Type;

export const Events_METHODS = {
  subscribe: "events.subscribe",
} as const;

export const EventsRpcGroup = RpcGroup.make(
  Rpc.make(Events_METHODS.subscribe, {
    payload: Schema.Struct({}),
    success: XtendEvent,
    stream: true,
  }),
);
