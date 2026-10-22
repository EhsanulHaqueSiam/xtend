import * as RpcGroup from "effect/rpc/RpcGroup";

/** Compose screen contracts: schemas, errors, method names and the RPC group. Owned by the compose area. */
export const Compose_METHODS = {} as const;

export const ComposeRpcGroup = RpcGroup.make();
