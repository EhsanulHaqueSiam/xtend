import { Automate_METHODS, AutomateRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AutomationEngine from "./AutomationEngine.ts";
import * as RuleStore from "./RuleStore.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.mergeAll(AutomationEngine.layerScheduler, AutomationEngine.layer).pipe(
  Layer.provideMerge(RuleStore.layer),
);

/** RPC handlers for AutomateRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = AutomateRpcGroup.toLayer(
  Effect.gen(function* () {
    const rules = yield* RuleStore.RuleStore;
    const engine = yield* AutomationEngine.AutomationEngine;
    return AutomateRpcGroup.of({
      [Automate_METHODS.rulesList]: () => rules.list,
      [Automate_METHODS.ruleUpsert]: (input) => rules.upsert(input),
      [Automate_METHODS.ruleDelete]: ({ id }) => rules.remove(id),
      [Automate_METHODS.ruleRunNow]: ({ id }) => engine.runRule(id),
      [Automate_METHODS.preview]: () => engine.preview,
      [Automate_METHODS.runsList]: (filter) => rules.runs(filter),
    });
  }),
);
