import { contextBridge, ipcRenderer } from "electron";

import {
  ACCOUNT_SELECT_CHANNEL,
  BRIDGE_ARG,
  type BridgeInfo,
  EDITING_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  REMOTE_SET_CHANNEL,
  OPEN_ROUTE_CHANNEL,
  SESSION_DOWNLOAD_CHANNEL,
  SESSION_FIND_CHANNEL,
  SESSION_FIND_RESULT_CHANNEL,
  SESSION_NAVIGATE_CHANNEL,
  SESSION_URL_CHANNEL,
  SESSION_VIEW_BOUNDS_CHANNEL,
  SESSION_VIEW_HIDDEN_CHANNEL,
  SHORTCUT_CHANNEL,
  type SessionDownload,
  type SessionFind,
  type SessionFindResult,
  type SessionNavigation,
} from "./ipc/channels.ts";

/** Subscribes `cb` to a main -> renderer channel; returns the unsubscribe. */
const listen =
  <T>(channel: string) =>
  (cb: (value: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };

const navigate = (navigation: SessionNavigation) =>
  ipcRenderer.send(SESSION_NAVIGATE_CHANNEL, navigation);

const info = JSON.parse(
  process.argv.find((a) => a.startsWith(BRIDGE_ARG))?.slice(BRIDGE_ARG.length) ?? "{}",
) as Partial<BridgeInfo>;

/** Mirrors `DesktopBridge` in apps/web/src/desktopBridge.ts. */
contextBridge.exposeInMainWorld("desktopBridge", {
  platform: process.platform,
  serviceToken: info.serviceToken ?? "",
  serviceMode: info.serviceMode ?? "none",
  remote: info.remote ?? null,
  accountId: info.accountId ?? 1,
  checkRemote: (config: unknown) => ipcRenderer.invoke(REMOTE_CHECK_CHANNEL, config),
  setRemote: (config: unknown) => ipcRenderer.send(REMOTE_SET_CHANNEL, config),
  selectAccount: (id: number) => ipcRenderer.send(ACCOUNT_SELECT_CHANNEL, id),
  setSessionViewBounds: (bounds: unknown) => ipcRenderer.send(SESSION_VIEW_BOUNDS_CHANNEL, bounds),
  setSessionViewHidden: (hidden: boolean) => ipcRenderer.send(SESSION_VIEW_HIDDEN_CHANNEL, hidden),
  navigateSession: (url: string) => navigate({ action: "url", url }),
  sessionBack: () => navigate({ action: "back" }),
  sessionForward: () => navigate({ action: "forward" }),
  sessionReload: () => navigate({ action: "reload" }),
  sessionFind: (find: SessionFind) => ipcRenderer.send(SESSION_FIND_CHANNEL, find),
  openExternal: (url: string) => ipcRenderer.send(OPEN_EXTERNAL_CHANNEL, url),
  onSessionUrl: listen<string>(SESSION_URL_CHANNEL),
  onSessionFindResult: listen<SessionFindResult>(SESSION_FIND_RESULT_CHANNEL),
  onSessionDownload: listen<SessionDownload>(SESSION_DOWNLOAD_CHANNEL),
  onShortcut: listen<string>(SHORTCUT_CHANNEL),
  onOpenRoute: listen<string>(OPEN_ROUTE_CHANNEL),
});

// Single-letter shortcuts must not fire while the user types in the app.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
window.addEventListener("focusin", (e) => ipcRenderer.send(EDITING_CHANNEL, isEditable(e.target)));
window.addEventListener("focusout", () => ipcRenderer.send(EDITING_CHANNEL, false));
