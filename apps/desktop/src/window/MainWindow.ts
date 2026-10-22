import * as path from "node:path";

import { BrowserWindow, ipcMain, shell, WebContentsView, type Rectangle } from "electron";

import { SESSION_VIEW_BOUNDS_CHANNEL } from "../ipc/channels.ts";
import { attachSessionCapture } from "../xSession/SessionCapture.ts";

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
const X_HOME = "https://x.com/home";

export interface MainWindowOptions {
  readonly appUrl: string;
  readonly serviceUrl: string;
  readonly log: (message: string, detail?: unknown) => void;
}

const isXHost = (url: string) => {
  try {
    return X_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Only web URLs leave the app; a page must not be able to launch file: or custom-scheme handlers. */
const openExternalWeb = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      void shell.openExternal(parsed.toString());
    }
  } catch {}
};

/** Chromium's UA minus the Electron and app tokens, so x.com serves its normal desktop site. */
const browserUserAgent = (ua: string) =>
  ua
    .replace(/ Electron\/\S+/, "")
    .replace(/ corvid\/\S+/i, "")
    .replace(/ @corvid\/\S+/i, "");

const isBounds = (value: unknown): value is Rectangle =>
  typeof value === "object" &&
  value !== null &&
  ["x", "y", "width", "height"].every(
    (k) => typeof (value as Record<string, unknown>)[k] === "number",
  );

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Corvid",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // The session view is a sibling native view, not an iframe: X's frame-busting
  // never sees it, and its cookies live in their own persistent partition.
  const session = new WebContentsView({
    webPreferences: { partition: "persist:x-session", contextIsolation: true, sandbox: true },
  });
  session.setBackgroundColor("#000000");
  session.webContents.setUserAgent(browserUserAgent(session.webContents.getUserAgent()));
  session.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  window.contentView.addChildView(session);

  // Stay on X inside the app; everything else goes to the default browser.
  session.webContents.setWindowOpenHandler(({ url }) => {
    if (isXHost(url)) {
      void session.webContents.loadURL(url);
    } else {
      openExternalWeb(url);
    }
    return { action: "deny" };
  });
  session.webContents.on("will-navigate", (event, url) => {
    if (isXHost(url)) return;
    event.preventDefault();
    openExternalWeb(url);
  });

  const detachCapture = attachSessionCapture(session.webContents, {
    serviceUrl: options.serviceUrl,
    // shortcut: viewer handle unknown until the session reads it from X; batches carry null, upgrade when accounts land.
    viewerHandle: () => null,
    log: options.log,
  });

  const onBounds = (event: Electron.IpcMainEvent, bounds: unknown) => {
    if (event.sender !== window.webContents) return;
    session.setBounds(isBounds(bounds) ? bounds : { x: 0, y: 0, width: 0, height: 0 });
  };
  ipcMain.on(SESSION_VIEW_BOUNDS_CHANNEL, onBounds);

  window.on("closed", () => {
    ipcMain.off(SESSION_VIEW_BOUNDS_CHANNEL, onBounds);
    detachCapture();
  });

  void session.webContents.loadURL(X_HOME);
  void window.loadURL(options.appUrl);
  return window;
}
