import { WS_METHODS, type SettingsUpdate } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/** How many times the service adopted the session's handle; settings refetch when it moves. */
const handleAdoptedAtom = Atom.make(
  (get) =>
    get(eventsOfTypeAtom("observation_recorded")).filter((e) => "handleAdopted" in e.payload)
      .length,
);

export const settingsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(handleAdoptedAtom);
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.settingsGet]({});
  }),
);

export const updateSettingsAtom = clientRuntime.fn<SettingsUpdate>()(
  Effect.fnUntraced(function* (patch) {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.settingsUpdate](patch);
  }),
);
