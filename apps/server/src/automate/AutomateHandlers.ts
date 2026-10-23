import { Automate_METHODS, AutomateRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PeopleStore from "../leads/PeopleStore.ts";
import * as XExtra from "../leads/XExtra.ts";
import * as Treg from "../x/Treg.ts";
import * as AutomationEngine from "./AutomationEngine.ts";
import * as RuleStore from "./RuleStore.ts";
import * as Webhooks from "./Webhooks.ts";

/**
 * Services this area adds to the application. Merged into layerAreas in server.ts.
 * PeopleStore and XExtra are the leads area's; Effect memoizes a layer by reference, so this shares theirs.
 */
export const layer = Layer.mergeAll(AutomationEngine.layerScheduler, AutomationEngine.layer).pipe(
  Layer.provideMerge(RuleStore.layer),
  Layer.provide(Layer.mergeAll(PeopleStore.layer, XExtra.layer.pipe(Layer.provide(Treg.layer)))),
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
      [Automate_METHODS.pendingList]: () => rules.pendingList,
      [Automate_METHODS.pendingApprove]: ({ id }) => engine.approve(id),
      [Automate_METHODS.pendingDismiss]: ({ id }) => engine.dismiss(id),
      [Automate_METHODS.dryRun7d]: ({ id }) => engine.dryRun7d(id),
      [Automate_METHODS.webhookInfo]: ({ id }) =>
        Effect.map(rules.webhookSecret(id), (secret) => ({
          path: Webhooks.WEBHOOK_PATH(id),
          secret,
        })),
    });
  }),
);
