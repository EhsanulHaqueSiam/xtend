import type { EngineBatch, XSkinToggle } from "@xtend/contracts";
import { contextBridge, ipcRenderer } from "electron";

import {
  ACCOUNT_SELECT_CHANNEL,
  APP_ROUTE_CHANNEL,
  BRIDGE_INFO_CHANNEL,
  type BridgeInfo,
  EMOJI_PANEL_CHANNEL,
  ENGINE_CHANNEL,
  GLANCE_CHANNEL,
  type Glance,
  OPEN_EXTERNAL_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  RECOVERY_RETRY_CHANNEL,
  REMOTE_SET_CHANNEL,
  SESSION_DOWNLOAD_CHANNEL,
  SHORTCUT_CHANNEL,
  type SessionDownload,
  type ShortcutKey,
  UPDATE_CHANNEL_SET_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_GET_CHANNEL,
  UPDATE_RESTART_CHANNEL,
  UPDATE_STATE_CHANNEL,
  type UpdateChannel,
  type UpdateState,
  X_SKIN_CHANNEL,
} from "./ipc/channels.ts";
import { holdUntilHeard } from "./ipc/hold.ts";
import { X_HOME } from "./window/guestPolicy.ts";

/** Subscribes `cb` to a main -> renderer channel; returns the unsubscribe. */
const listen =
  <T>(channel: string) =>
  (cb: (value: T) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  };

// X's first pages arrive while the app page mounts; held, they reach the store once it listens.
const engine = holdUntilHeard<EngineBatch>(100);
ipcRenderer.on(ENGINE_CHANNEL, (_event, batch: EngineBatch) => engine.push(batch));

// Synchronous so the page sees the token at module load, like a meta tag would.
const info = (ipcRenderer.sendSync(BRIDGE_INFO_CHANNEL) ?? {}) as Partial<BridgeInfo>;

/** Mirrors `DesktopBridge` in apps/web/src/desktopBridge.ts. */
contextBridge.exposeInMainWorld("desktopBridge", {
  platform: process.platform,
  serviceToken: info.serviceToken ?? "",
  serviceMode: info.serviceMode ?? "none",
  remote: info.remote ?? null,
  accountId: info.accountId ?? 1,
  xPartition: info.xPartition ?? "persist:x-session",
  xStartUrl: info.xStartUrl ?? X_HOME,
  initialRoute: info.initialRoute ?? null,
  retryService: () => ipcRenderer.send(RECOVERY_RETRY_CHANNEL),
  checkRemote: (config: unknown) => ipcRenderer.invoke(REMOTE_CHECK_CHANNEL, config),
  setRemote: (config: unknown) => ipcRenderer.send(REMOTE_SET_CHANNEL, config),
  selectAccount: (id: number) => ipcRenderer.send(ACCOUNT_SELECT_CHANNEL, id),
  pushGlance: (glance: Glance) => ipcRenderer.send(GLANCE_CHANNEL, glance),
  setXSkin: (on: ReadonlyArray<XSkinToggle>) => ipcRenderer.send(X_SKIN_CHANNEL, on),
  openExternal: (url: string) => ipcRenderer.send(OPEN_EXTERNAL_CHANNEL, url),
  showEmojiPanel: () => ipcRenderer.send(EMOJI_PANEL_CHANNEL),
  onAppRoute: listen<string>(APP_ROUTE_CHANNEL),
  onSessionDownload: listen<SessionDownload>(SESSION_DOWNLOAD_CHANNEL),
  onShortcut: listen<ShortcutKey>(SHORTCUT_CHANNEL),
  getUpdate: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_GET_CHANNEL),
  onUpdate: listen<UpdateState>(UPDATE_STATE_CHANNEL),
  onEngine: engine.listen,
  checkUpdate: () => ipcRenderer.send(UPDATE_CHECK_CHANNEL),
  setUpdateChannel: (channel: UpdateChannel) =>
    ipcRenderer.send(UPDATE_CHANNEL_SET_CHANNEL, channel),
  restartToUpdate: () => ipcRenderer.send(UPDATE_RESTART_CHANNEL),
});
