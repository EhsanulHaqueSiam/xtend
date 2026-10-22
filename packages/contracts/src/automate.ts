import * as RpcGroup from "effect/rpc/RpcGroup";

/** Automate screen contracts: schemas, errors, method names and the RPC group. Owned by the automate area. */
export const Automate_METHODS = {} as const;

export const AutomateRpcGroup = RpcGroup.make();
