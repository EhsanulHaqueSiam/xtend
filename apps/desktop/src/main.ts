import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { app, BrowserWindow } from "electron";

import { createMainWindow } from "./window/MainWindow.ts";

// shortcut: the desktop expects a running service; it will supervise one itself when packaging lands.
const serviceUrl = process.env.XTEND_SERVICE_URL ?? "http://127.0.0.1:4820";
const appUrl = process.env.XTEND_DEV_URL ?? serviceUrl;

const log = (message: string, detail?: unknown) => {
  // Main-process diagnostics go to the launcher's terminal.
  console.log(`[xtend-desktop] ${message}`, detail ?? "");
};

/** The service's data directory: `--base-dir`, then XTEND_HOME, then ~/.xtend, same order as the service. */
const baseDirArg = process.argv.indexOf("--base-dir");
const baseDir = path.resolve(
  (baseDirArg !== -1 ? process.argv[baseDirArg + 1] : undefined) ??
    process.env.XTEND_HOME ??
    path.join(os.homedir(), ".xtend"),
);

// The service writes auth-token on first start; sharing its base dir is how the desktop is trusted.
const readServiceToken = (): string => {
  const override = process.env.XTEND_SERVICE_TOKEN;
  if (override !== undefined && override !== "") return override;
  try {
    return fs.readFileSync(path.join(baseDir, "auth-token"), "utf8").trim();
  } catch (error) {
    log("no service token; start the service once with this base dir", {
      baseDir,
      error: String(error),
    });
    return "";
  }
};

// Headless verification: scripts/cdp-screenshot.mjs reads every page through this port.
// Dev builds only: any local process could attach to the x.com target and read its cookies.
const remoteDebugPort = process.env.XTEND_REMOTE_DEBUG;
if (remoteDebugPort !== undefined && !app.isPackaged)
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);

const openWindow = () =>
  createMainWindow({
    appUrl,
    serviceUrl,
    serviceToken: readServiceToken(),
    queueDir: path.join(baseDir, "observation-queue"),
    importCookiesPath: process.env.XTEND_IMPORT_COOKIES,
    log,
  });

void app.whenReady().then(() => {
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
