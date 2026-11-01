import { useAtomValue } from "@effect/atom-react";
import { WS_METHODS, type SettingsUpdate } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { isElectron } from "../env";
import { clientRuntime, XtendClient } from "../rpc/client";
import { viewerHandleAtom } from "./engine";
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

/**
 * The user's own handle for their own X pages (Profile, the panel beside Compose): the account X
 * is signed in as, which Settings' handle may not match. The desktop waits for X to say; a
 * browser, with no engine, takes Settings' handle.
 */
export const ownHandleAtom = Atom.make(
  (get) =>
    get(viewerHandleAtom) ??
    (isElectron
      ? null
      : AsyncResult.getOrElse(
          AsyncResult.map(get(settingsAtom), (s) => s.handle),
          () => null,
        )),
);

export const updateSettingsAtom = clientRuntime.fn<SettingsUpdate>()(
  Effect.fnUntraced(function* (patch) {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.settingsUpdate](patch);
  }),
);

/** Whether a clicked post or reply goes through the user's own X session (desktop, lane on): free. */
export function useSessionLane(): boolean {
  const settings = useAtomValue(settingsAtom);
  return (
    isElectron &&
    AsyncResult.getOrElse(
      AsyncResult.map(settings, (s) => s.sessionPostingEnabled),
      () => false,
    )
  );
}
