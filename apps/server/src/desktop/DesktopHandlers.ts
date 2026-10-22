import { Desktop_METHODS, DesktopRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as DesktopChannel from "./DesktopChannel.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = DesktopChannel.layer;

/** RPC handlers for DesktopRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = DesktopRpcGroup.toLayer(
  Effect.gen(function* () {
    const channel = yield* DesktopChannel.DesktopChannel;
    return DesktopRpcGroup.of({
      [Desktop_METHODS.subscribeCommands]: () => channel.subscribe,
      [Desktop_METHODS.completeCommand]: (completion) => channel.complete(completion),
    });
  }),
);
