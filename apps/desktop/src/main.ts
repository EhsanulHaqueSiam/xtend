import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import { autoUpdater } from "electron-updater";

import {
  ACCOUNT_SELECT_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  REMOTE_SET_CHANNEL,
  UPDATE_CHANNEL_SET_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_GET_CHANNEL,
  UPDATE_RESTART_CHANNEL,
  UPDATE_STATE_CHANNEL,
  type UpdateState,
} from "./ipc/channels.ts";
import { checkRemote, readRemote, RemoteConfig, writeRemote } from "./service/remote.ts";
import { superviseService } from "./service/ServiceSupervisor.ts";
import { deepLinkToRoute, type ServiceMode } from "./service/supervision.ts";
import { createTray } from "./tray.ts";
import { defaultChannel, devUpdateFeed, startUpdates } from "./updates.ts";
import { createMainWindow } from "./window/MainWindow.ts";
import { mockXOrigin } from "./window/mockX.ts";
import * as Schema from "effect/Schema";

const log = (message: string, detail?: unknown) => {
  // Main-process diagnostics go to the launcher's terminal.
  console.log(`[xtend-desktop] ${message}`, detail ?? "");
};

/** The service's data directory: `--base-dir`, then XTEND_HOME, then ~/.xtend, same order as the service. */
const baseDirArg = process.argv.indexOf("--base-dir");
const baseDir = NodePath.resolve(
  (baseDirArg !== -1 ? process.argv[baseDirArg + 1] : undefined) ??
    process.env.XTEND_HOME ??
    NodePath.join(NodeOS.homedir(), ".xtend"),
);

// Smoke runs and tests keep their window config, sessions and cookies apart from the user's.
const userDataOverride = process.env.XTEND_USER_DATA;
if (userDataOverride !== undefined && !app.isPackaged) app.setPath("userData", userDataOverride);

// The desktop's own config (which service to use) lives in userData, never in the service DB.
const configFile = NodePath.join(app.getPath("userData"), "config.json");
// An explicit service URL wins over the saved remote, token included: a dev desktop shares the
// installed app's userData and must not send the remote's token to its own service.
const remote = process.env.XTEND_SERVICE_URL === undefined ? readRemote(configFile) : null;
const serviceUrl = process.env.XTEND_SERVICE_URL ?? remote?.url ?? "http://127.0.0.1:4820";
const appUrl = process.env.XTEND_DEV_URL ?? serviceUrl;
// Dev and tests only: the session view's x.com answered by mock X on this machine.
const mockX = mockXOrigin(process.env.XTEND_MOCK_X, app.isPackaged);
if (mockX !== null) log("x.com is mock X", mockX);

// The service writes auth-token on first start; sharing its base dir is how the desktop is trusted.
const readServiceToken = (): string => {
  const override = process.env.XTEND_SERVICE_TOKEN;
  if (override !== undefined && override !== "") return override;
  if (remote !== null) return remote.token;
  try {
    return NodeFS.readFileSync(NodePath.join(baseDir, "auth-token"), "utf8").trim();
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
if (remoteDebugPort !== undefined && !app.isPackaged) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
  // A headless host's window is covered or its screen locked; macOS then calls it occluded and
  // Chromium stops drawing it, so nothing that waits on a frame (X's infinite scroll) would run.
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}

const decodeRemote = Schema.decodeUnknownResult(Schema.NullOr(RemoteConfig));

const openSocket = (url: string) =>
  new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url);
    const finish = (accepted: boolean) => {
      clearTimeout(timeout);
      ws.close();
      resolve(accepted);
    };
    const timeout = setTimeout(() => finish(false), 5_000);
    ws.addEventListener("open", () => finish(true));
    ws.addEventListener("error", () => finish(false));
    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
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
    queueDir: NodePath.join(baseDir, "observation-queue"),
    sessionUrlFile: NodePath.join(baseDir, "session-url"),
    importCookiesPath: process.env.XTEND_IMPORT_COOKIES,
    mockX,
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
      NodeFS.writeFileSync(NodePath.join(shotDir, `${Date.now()}.png`), image.toPNG());
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
// Windows and Linux hand the link that launched the app in argv, not as an event.
const launchLink = process.argv.find((a) => a.startsWith("xtend://"));
if (launchLink !== undefined) handleDeepLink(launchLink);

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
    return checkRemote(decoded.success, {
      fetch: (url) => fetch(url, { signal: AbortSignal.timeout(5_000) }),
      openSocket,
    });
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

  // A dev build has no feed, unless XTEND_UPDATE_FEED names a local one: it reports idle.
  const version = app.getVersion();
  const devFeed = app.isPackaged ? null : devUpdateFeed(process.env.XTEND_UPDATE_FEED);
  if (devFeed !== null) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: "generic", url: devFeed });
  }
  const updates =
    app.isPackaged || devFeed !== null
      ? startUpdates({
          updater: autoUpdater,
          version,
          platform: process.platform,
          channelFile: NodePath.join(app.getPath("userData"), "updates.json"),
          broadcast: (state: UpdateState) => main?.appContents.send(UPDATE_STATE_CHANNEL, state),
          log,
        })
      : null;
  ipcMain.handle(
    UPDATE_GET_CHANNEL,
    (): UpdateState =>
      updates?.state ?? { channel: defaultChannel(version), version, status: "idle" },
  );
  ipcMain.on(UPDATE_CHECK_CHANNEL, (event) => {
    if (fromApp(event)) updates?.check();
  });
  ipcMain.on(UPDATE_CHANNEL_SET_CHANNEL, (event, channel: unknown) => {
    if (fromApp(event) && (channel === "stable" || channel === "nightly"))
      updates?.setChannel(channel);
  });
  ipcMain.on(UPDATE_RESTART_CHANNEL, (event) => {
    if (fromApp(event)) updates?.restart();
  });
});

// The tray keeps the app alive on macOS; elsewhere closing the window quits.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
