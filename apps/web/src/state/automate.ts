import { Automate_METHODS, type RuleInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

// A rule that fires on the service's own clock changes its spend, the runs log and Needs you.
export const rulesAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("rule_fired"));
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.rulesList]({});
  }),
);

/** Newest first, capped by the service. Refresh after any run. */
export const runsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("rule_fired"));
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

/** What every enabled rule would do right now. Reads only stored or cached data, so it is free; fires nothing. */
export const previewAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.preview]({});
  }),
);

/** Ask-first requests waiting for a click. Refresh after approving, dismissing or any run. */
export const pendingAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("rule_fired"));
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.pendingList]({});
  }),
);

/** Performs the queued action now. Paid at the cost the request shows. */
export const approvePendingAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.pendingApprove]({ id });
  }),
);

export const dismissPendingAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.pendingDismiss]({ id });
  }),
);

/** Replays one rule over the last 7 days of stored data. Free. */
export const dryRun7dAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.dryRun7d]({ id });
  }),
);

export const webhookInfoAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Automate_METHODS.webhookInfo]({ id });
  }),
);
