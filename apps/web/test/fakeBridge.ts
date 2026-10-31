import type { EngineBatch } from "@xtend/contracts";

import type { DesktopBridge, ShortcutKey } from "../src/desktopBridge";

/**
 * Installs a desktop bridge that records calls, so a test can play the main
 * process. `emit` fires the routes and keys main would send.
 */
export function installFakeBridge(overrides: Partial<DesktopBridge> = {}) {
  const calls: Array<string> = [];
  const routes = new Set<(route: string) => void>();
  const shortcuts = new Set<(key: ShortcutKey) => void>();
  const engine = new Set<(batch: EngineBatch) => void>();
  const subscribe =
    <T>(set: Set<(value: T) => void>) =>
    (cb: (value: T) => void) => {
      set.add(cb);
      return () => set.delete(cb);
    };
  const bridge: DesktopBridge = {
    platform: "darwin",
    serviceToken: "",
    serviceMode: "none",
    remote: null,
    accountId: 1,
    xPartition: "persist:x-session",
    xStartUrl: "https://x.com/home",
    initialRoute: null,
    checkRemote: () => Promise.resolve({ health: false, version: null, auth: false, error: null }),
    setRemote: () => {},
    selectAccount: () => {},
    pushGlance: () => {},
    setXSkin: (on) => calls.push(`skin ${on.join(",")}`),
    openExternal: (url) => calls.push(`external ${url}`),
    onAppRoute: subscribe(routes),
    onSessionDownload: () => () => {},
    onShortcut: subscribe(shortcuts),
    getUpdate: () => Promise.resolve({ channel: "stable", version: "0.0.1", status: "idle" }),
    onUpdate: () => () => {},
    onEngine: subscribe(engine),
    checkUpdate: () => calls.push("update check"),
    setUpdateChannel: (channel) => calls.push(`update channel ${channel}`),
    restartToUpdate: () => calls.push("update restart"),
    ...overrides,
  };
  window.desktopBridge = bridge;
  return {
    calls,
    emitRoute: (route: string) => routes.forEach((cb) => cb(route)),
    emitEngine: (batch: EngineBatch) => engine.forEach((cb) => cb(batch)),
    emitShortcut: (key: ShortcutKey) => shortcuts.forEach((cb) => cb(key)),
  };
}
