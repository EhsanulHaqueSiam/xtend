import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { autoUpdater } from "electron-updater";

import {
  ACCOUNT_SELECT_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  REMOTE_SET_CHANNEL,
} from "./ipc/channels.ts";
import { checkRemote, readRemote, RemoteConfig, writeRemote } from "./service/remote.ts";
import { superviseService } from "./service/ServiceSupervisor.ts";
import { deepLinkToRoute, type ServiceMode } from "./service/supervision.ts";
import { createTray } from "./tray.ts";
import { createMainWindow } from "./window/MainWindow.ts";
import * as Schema from "effect/Schema";

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

// Smoke runs and tests keep their window config, sessions and cookies apart from the user's.
const userDataOverride = process.env.XTEND_USER_DATA;
if (userDataOverride !== undefined && !app.isPackaged) app.setPath("userData", userDataOverride);

// The desktop's own config (which service to use) lives in userData, never in the service DB.
const configFile = path.join(app.getPath("userData"), "config.json");
// An explicit service URL wins over the saved remote, token included: a dev desktop shares the
// installed app's userData and must not send the remote's token to its own service.
const remote = process.env.XTEND_SERVICE_URL === undefined ? readRemote(configFile) : null;
const serviceUrl = process.env.XTEND_SERVICE_URL ?? remote?.url ?? "http://127.0.0.1:4820";
const appUrl = process.env.XTEND_DEV_URL ?? serviceUrl;

// The service writes auth-token on first start; sharing its base dir is how the desktop is trusted.
const readServiceToken = (): string => {
  const override = process.env.XTEND_SERVICE_TOKEN;
  if (override !== undefined && override !== "") return override;
  if (remote !== null) return remote.token;
  try {
    return fs.readFileSync(path.join(baseDir, "auth-token"), "utf8").trim();
  } catch (error) {
    log("no service token yet", { baseDir, error: String(error) });
    return "";
  }
};

/** The current account from the service, so the session view opens the right partition. */
const currentAccountId = async (token: string): Promise<number> => {
  try {
    const response = await fetch(new URL("/api/rpc/accounts.list", serviceUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3_000),
    });
    const list = (await response.json()) as { currentId?: number };
    return list.currentId ?? 1;
  } catch {
    return 1;
  }
};

// Headless verification: scripts/cdp.mjs drives every page through this port.
// Dev builds only: any local process could attach to the x.com target and read its cookies.
const remoteDebugPort = process.env.XTEND_REMOTE_DEBUG;
if (remoteDebugPort !== undefined && !app.isPackaged)
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);

const decodeRemote = Schema.decodeUnknownResult(Schema.NullOr(RemoteConfig));

const openSocket = (url: string) =>
  new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      ws.close();
      resolve(true);
    });
    ws.addEventListener("error", () => resolve(false));
  });

let main: ReturnType<typeof createMainWindow> | undefined;
let serviceMode: ServiceMode = "none";
let accountId = 1;

/** A screen asked for from outside (deep link); x.com stays beside it in the side panel. */
const openRoute = (route: string) => main?.openRoute(route);

const openWindow = () => {
  if (main !== undefined && !main.window.isDestroyed()) return main.window.show();
  const serviceToken = readServiceToken();
  const created = createMainWindow({
    appUrl,
    serviceUrl,
    serviceToken,
    accountId,
    bridgeInfo: { serviceToken, serviceMode, remote, accountId },
    queueDir: path.join(baseDir, "observation-queue"),
    sessionUrlFile: path.join(baseDir, "session-url"),
    importCookiesPath: process.env.XTEND_IMPORT_COOKIES,
    log,
  });
  main = created;
  // An account switch closes the old window after the new one opened; that close must not forget the new one.
  created.window.on("closed", () => {
    if (main === created) main = undefined;
  });
};

// Dev only: `kill -USR2 <pid>` writes <ts>.png (the window, x.com included) to XTEND_SHOT_DIR,
// for agents without a screen.
const shotDir = process.env.XTEND_SHOT_DIR;
if (shotDir !== undefined && !app.isPackaged) {
  process.on("SIGUSR2", () => {
    void main?.capture().then((image) => {
      fs.writeFileSync(path.join(shotDir, `${Date.now()}.png`), image.toPNG());
    });
  });
}

// xtend://compose?text=... and xtend://report?handle=... open the app on that screen.
if (app.isPackaged) app.setAsDefaultProtocolClient("xtend");
// Set once the service answered and the first window is open; a link that arrives earlier waits.
let started = false;
let pendingRoute: string | null = null;
const handleDeepLink = (url: string) => {
  const route = deepLinkToRoute(url);
  log("deep link", { url, route });
  if (route === null) return;
  // macOS delivers the link that launched the app before `ready`, when no window may exist yet.
  if (!started) {
    pendingRoute = route;
    return;
  }
  openWindow();
  openRoute(route);
};
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", (_event, argv) => {
  const link = argv.find((a) => a.startsWith("xtend://"));
  if (link !== undefined) handleDeepLink(link);
  else if (started) openWindow();
});
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Xtend is dark-only; x.com's "follow the system" theme should land on dark too.
nativeTheme.themeSource = "dark";

void app.whenReady().then(async () => {
  // A second instance only hands its argv to the first; supervising too could start a second service.
  if (!primary) return;
  const supervision = await superviseService({
    serviceUrl,
    remote: remote !== null,
    baseDir,
    devUrl: process.env.XTEND_DEV_URL,
    log,
  });
  serviceMode = supervision.mode;
  app.on("before-quit", supervision.stop);
  accountId = await currentAccountId(readServiceToken());

  // Only the app view may repoint the service or switch accounts; every other page is x.com or a sign-in popup.
  const fromApp = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    main !== undefined && event.sender === main.appContents;
  ipcMain.handle(REMOTE_CHECK_CHANNEL, (event, config: unknown) => {
    if (!fromApp(event)) throw new Error("remote check is only for the app view");
    const decoded = decodeRemote(config);
    if (decoded._tag === "Failure" || decoded.success === null)
      return {
        health: false,
        version: null,
        auth: false,
        error: "needs an http(s) URL and a token",
      };
    return checkRemote(decoded.success, { fetch, openSocket });
  });
  // Changing the service means a different token, base dir and account: a relaunch is the honest reload.
  ipcMain.on(REMOTE_SET_CHANNEL, (event, config: unknown) => {
    if (!fromApp(event)) return;
    const decoded = decodeRemote(config);
    if (decoded._tag === "Failure") return;
    writeRemote(configFile, decoded.success);
    app.relaunch();
    app.quit();
  });
  // The session partition is fixed at view creation, so a switch rebuilds the window on the new one.
  ipcMain.on(ACCOUNT_SELECT_CHANNEL, (event, id: unknown) => {
    if (!fromApp(event)) return;
    if (typeof id !== "number" || !Number.isInteger(id) || id === accountId) return;
    accountId = id;
    const old = main;
    main = undefined;
    openWindow();
    old?.window.close();
  });

  createTray(openWindow);
  openWindow();
  started = true;
  if (pendingRoute !== null) openRoute(pendingRoute);
  pendingRoute = null;
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });

  if (app.isPackaged) {
    autoUpdater.on("error", (error) => log("updater", String(error)));
    // A private repo or no network rejects here; the error listener has already logged it.
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});

// The tray keeps the app alive on macOS; elsewhere closing the window quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
