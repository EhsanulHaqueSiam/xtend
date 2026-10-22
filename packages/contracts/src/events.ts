import * as RpcGroup from "effect/rpc/RpcGroup";

/** Events contracts: schemas, errors, method names and the RPC group. Owned by the events area. */
export const Events_METHODS = {} as const;

export const EventsRpcGroup = RpcGroup.make();
