import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useEffect, useRef } from "react";

import { helloDeviceAtom, useDevices } from "../../state/devices";
import { useDesktopUpdate } from "../../state/update";
import { xSkinAtom } from "../../state/x";

/**
 * Keeps this desktop's preferences in step with the service, where any device can change them:
 * says hello once (carrying what it had, for a device the service has not met), then applies its
 * stored Clean X and update channel whenever they change. A browser is not a device.
 */
export function DeviceSync() {
  const bridge = window.desktopBridge;
  const hello = useAtomSet(helloDeviceAtom, { mode: "promise" });
  const skin = useAtomValue(xSkinAtom);
  const setSkin = useAtomSet(xSkinAtom);
  const update = useDesktopUpdate();
  const own = useDevices().find((d) => d.id === bridge?.device.id);
  const greeted = useRef(false);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- registers this desktop with the service once per window.
  useEffect(() => {
    if (bridge === undefined || bridge.device.id === "" || greeted.current) return;
    greeted.current = true;
    void bridge
      .getUpdate()
      .then((u) => hello({ ...bridge.device, prefs: { cleanX: skin, updateChannel: u.channel } }))
      // A service from before devices has no such method; the window works as it did.
      .catch(() => {});
    // Once: the prefs it carries matter only the first time; later changes reach the service as edits.
  }, [bridge, hello, skin]);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- applies this device's prefs from the service (Clean X to the session view, the channel to the updater).
  useEffect(() => {
    if (own === undefined) return;
    const cleanX = own.prefs.cleanX;
    if (cleanX.length !== skin.length || cleanX.some((t) => !skin.includes(t))) setSkin(cleanX);
    const channel = own.prefs.updateChannel;
    if (channel !== null && update !== null && channel !== update.channel)
      bridge?.setUpdateChannel(channel);
  }, [own, skin, setSkin, update, bridge]);
  return null;
}
