import { useAtomValue } from "@effect/atom-react";
import { type Device, Devices_METHODS, type DevicePrefs } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/** Every desktop on this service, newest seen first; follows pairing, renames and pref changes. */
const devicesAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("devices_changed"));
    const client = yield* XtendClient;
    return yield* client[Devices_METHODS.list]({});
  }),
);

export const helloDeviceAtom = clientRuntime.fn<{
  readonly id: string;
  readonly name: string;
  readonly prefs: DevicePrefs;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Devices_METHODS.hello](input);
  }),
);

export const updateDeviceAtom = clientRuntime.fn<{
  readonly id: string;
  readonly name?: string;
  readonly prefs?: DevicePrefs;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Devices_METHODS.update](input);
  }),
);

export const removeDeviceAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Devices_METHODS.remove]({ id });
  }),
);

export const pairAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Devices_METHODS.pair]({});
  }),
);

/** The device Settings' per-device rows edit; null follows this desktop, or the newest seen. */
export const settingsDeviceIdAtom = Atom.make<string | null>(null);

const NONE: ReadonlyArray<Device> = [];

export function useDevices(): ReadonlyArray<Device> {
  return AsyncResult.getOrElse(useAtomValue(devicesAtom), () => NONE);
}

/** The device per-device settings apply to now, or null while there is none to edit. */
export function useSettingsDevice(): Device | null {
  const devices = useDevices();
  const picked = useAtomValue(settingsDeviceIdAtom);
  const own = window.desktopBridge?.device.id;
  return (
    devices.find((d) => d.id === picked) ?? devices.find((d) => d.id === own) ?? devices[0] ?? null
  );
}
