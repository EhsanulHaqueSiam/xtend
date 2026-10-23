import { contextBridge, ipcRenderer } from "electron";

import {
  ACCOUNT_SELECT_CHANNEL,
  BRIDGE_INFO_CHANNEL,
  type BridgeInfo,
  EDITING_CHANNEL,
  GLANCE_CHANNEL,
  type Glance,
  OPEN_EXTERNAL_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  REMOTE_SET_CHANNEL,
  SESSION_DOWNLOAD_CHANNEL,
  SESSION_FIND_CHANNEL,
  SESSION_FIND_RESULT_CHANNEL,
  SESSION_NAVIGATE_CHANNEL,
  SESSION_URL_CHANNEL,
  SHORTCUT_CHANNEL,
  SLOT_CHANNEL,
  SLOT_CLOSE_CHANNEL,
  SLOT_OPEN_CHANNEL,
  type SessionDownload,
  type SessionFind,
  type SessionFindResult,
  type SlotClose,
  type SlotOpen,
  type SlotState,
} from "./ipc/channels.ts";

/** Subscribes `cb` to a main -> renderer channel; returns the unsubscribe. */
const listen =
  <T>(channel: string) =>
  (cb: (value: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };

// Synchronous so the page sees the token at module load, like a meta tag would.
const info = (ipcRenderer.sendSync(BRIDGE_INFO_CHANNEL) ?? {}) as Partial<BridgeInfo>;

/** Mirrors `DesktopBridge` in apps/web/src/desktopBridge.ts. */
contextBridge.exposeInMainWorld("desktopBridge", {
  platform: process.platform,
  serviceToken: info.serviceToken ?? "",
  serviceMode: info.serviceMode ?? "none",
  remote: info.remote ?? null,
  accountId: info.accountId ?? 1,
  slot: info.slot ?? { kind: null, route: "/" },
  checkRemote: (config: unknown) => ipcRenderer.invoke(REMOTE_CHECK_CHANNEL, config),
  setRemote: (config: unknown) => ipcRenderer.send(REMOTE_SET_CHANNEL, config),
  selectAccount: (id: number) => ipcRenderer.send(ACCOUNT_SELECT_CHANNEL, id),
  openSlot: (slot: SlotOpen) => ipcRenderer.send(SLOT_OPEN_CHANNEL, slot),
  closeSlot: (close?: SlotClose) => ipcRenderer.send(SLOT_CLOSE_CHANNEL, close),
  pushGlance: (glance: Glance) => ipcRenderer.send(GLANCE_CHANNEL, glance),
  navigateSession: (url: string) => ipcRenderer.send(SESSION_NAVIGATE_CHANNEL, url),
  sessionFind: (find: SessionFind) => ipcRenderer.send(SESSION_FIND_CHANNEL, find),
  openExternal: (url: string) => ipcRenderer.send(OPEN_EXTERNAL_CHANNEL, url),
  onSlot: listen<SlotState>(SLOT_CHANNEL),
  onSessionUrl: listen<string>(SESSION_URL_CHANNEL),
  onSessionFindResult: listen<SessionFindResult>(SESSION_FIND_RESULT_CHANNEL),
  onSessionDownload: listen<SessionDownload>(SESSION_DOWNLOAD_CHANNEL),
  onShortcut: listen<string>(SHORTCUT_CHANNEL),
});

// Single-letter shortcuts must not fire while the user types in the app.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
window.addEventListener("focusin", (e) => ipcRenderer.send(EDITING_CHANNEL, isEditable(e.target)));
window.addEventListener("focusout", () => ipcRenderer.send(EDITING_CHANNEL, false));
