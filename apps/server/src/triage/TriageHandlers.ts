import { Triage_METHODS, TriageRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as Triage from "./Triage.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Triage.layer;

/** RPC handlers for TriageRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = TriageRpcGroup.toLayer(
  Effect.gen(function* () {
    const triage = yield* Triage.Triage;
    return TriageRpcGroup.of({
      [Triage_METHODS.paths]: () => triage.paths,
      [Triage_METHODS.context]: () => Effect.map(triage.context("app"), (text) => ({ text })),
      [Triage_METHODS.prepare]: () => triage.prepare("app"),
    });
  }),
);
