import { WS_METHODS, type SettingsUpdate } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const settingsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.settingsGet]({});
  }),
);

export const spendAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.spendSummary]({});
  }),
);

export const updateSettingsAtom = clientRuntime.fn<SettingsUpdate>()(
  Effect.fnUntraced(function* (patch) {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.settingsUpdate](patch);
  }),
);
