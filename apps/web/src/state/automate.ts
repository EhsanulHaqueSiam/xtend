import { Automate_METHODS, type RuleInput, type RuleRunStatus } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const rulesAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.rulesList]({});
  }),
);

/** Newest first, capped by the service. Refresh after any run. */
export const runsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.runsList]({});
  }),
);

export const upsertRuleAtom = clientRuntime.fn<RuleInput>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.ruleUpsert](input);
  }),
);

export const deleteRuleAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.ruleDelete]({ id });
  }),
);

/** Fires the rule now regardless of its enabled flag. Paid unless the rule is a dry run. */
export const runRuleNowAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.ruleRunNow]({ id });
  }),
);

/** What every enabled rule would do right now. Reads X (cached), fires nothing. */
export const previewAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.preview]({});
  }),
);

export type { RuleRunStatus };
