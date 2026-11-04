import { XSettings_METHODS, XSettingsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as XSettingsLog from "./XSettingsLog.ts";

export const layer = XSettingsLog.layer;

/** RPC handlers for XSettingsRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = XSettingsRpcGroup.toLayer(
  Effect.gen(function* () {
    const log = yield* XSettingsLog.XSettingsLog;
    return XSettingsRpcGroup.of({
      [XSettings_METHODS.seen]: ({ accountId, values, pressed }) =>
        log.seen(accountId, values, pressed),
      [XSettings_METHODS.changes]: () => log.changes,
    });
  }),
);
