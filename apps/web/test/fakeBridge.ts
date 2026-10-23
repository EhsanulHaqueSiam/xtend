import type { DesktopBridge, SlotState } from "../src/desktopBridge";

/** Installs a desktop bridge that records calls, so a test can play the main process. */
export function installFakeBridge(slot: SlotState = { kind: null, route: "/" }) {
  const calls: Array<string> = [];
  const bridge: DesktopBridge = {
    platform: "darwin",
    serviceToken: "",
    serviceMode: "none",
    remote: null,
    accountId: 1,
    slot,
    checkRemote: () => Promise.resolve({ health: false, version: null, auth: false, error: null }),
    setRemote: () => {},
    selectAccount: () => {},
    openSlot: (s) => calls.push(`open ${s.kind} ${s.route}`),
    closeSlot: (c) => calls.push(`close ${c?.kind ?? "*"}`),
    navigateSession: (url) => calls.push(`navigate ${url}`),
    sessionFind: (find) =>
      calls.push(
        find === null
          ? "find stop"
          : `find ${find.text} ${find.forward ? ">" : "<"} ${find.findNext}`,
      ),
    openExternal: () => {},
    onSlot: () => () => {},
    onSessionUrl: () => () => {},
    onSessionFindResult: () => () => {},
    onSessionDownload: () => () => {},
    onShortcut: () => () => {},
  };
  window.desktopBridge = bridge;
  return calls;
}
