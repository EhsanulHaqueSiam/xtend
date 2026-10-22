import { contextBridge, ipcRenderer } from "electron";

import { SESSION_VIEW_BOUNDS_CHANNEL } from "./ipc/channels.ts";

/** Mirrors `DesktopBridge` in apps/web/src/desktopBridge.ts. */
contextBridge.exposeInMainWorld("desktopBridge", {
  platform: process.platform,
  setSessionViewBounds: (bounds: unknown) => ipcRenderer.send(SESSION_VIEW_BOUNDS_CHANNEL, bounds),
});
