import { app, BrowserWindow } from "electron";

import { createMainWindow } from "./window/MainWindow.ts";

// shortcut: the desktop expects a running service; it will supervise one itself when packaging lands.
const serviceUrl = process.env.XTEND_SERVICE_URL ?? "http://127.0.0.1:4820";
const appUrl = process.env.XTEND_DEV_URL ?? serviceUrl;

const log = (message: string, detail?: unknown) => {
  // eslint-disable-next-line no-console -- main-process diagnostics go to the launcher's terminal.
  console.log(`[xtend-desktop] ${message}`, detail ?? "");
};

// Headless verification: scripts/cdp-screenshot.mjs reads every page through this port.
const remoteDebugPort = process.env.XTEND_REMOTE_DEBUG;
if (remoteDebugPort !== undefined)
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);

const openWindow = () => createMainWindow({ appUrl, serviceUrl, log });

void app.whenReady().then(() => {
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
