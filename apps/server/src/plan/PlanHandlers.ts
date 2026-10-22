import { PlanRpcGroup } from "@xtend/contracts";
import * as Layer from "effect/Layer";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.empty;

/** RPC handlers for PlanRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = PlanRpcGroup.toLayer({});
