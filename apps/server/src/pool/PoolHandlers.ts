import { Pool_METHODS, PoolRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as Pool from "./Pool.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Pool.layer;

/** RPC handlers for PoolRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = PoolRpcGroup.toLayer(
  Effect.gen(function* () {
    const pool = yield* Pool.Pool;
    return PoolRpcGroup.of({
      [Pool_METHODS.trends]: () => pool.trends,
    });
  }),
);
