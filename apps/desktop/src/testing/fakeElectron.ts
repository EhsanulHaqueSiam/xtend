import { EventEmitter } from "node:events";

import type { Rect } from "../ipc/channels.ts";

/**
 * Just enough of Electron for main.ts and MainWindow.ts to run in a unit test:
 * `vi.mock("electron", () => import("../testing/fakeElectron.ts"))`. IPC goes
 * through `ipcMain` with a chosen sender, so tests can play the app view, the
 * x.com window or a stranger.
 */

export class FakeContents extends EventEmitter {
  readonly sent: Array<readonly [string, unknown]> = [];
  readonly loaded: Array<string> = [];
  zoomLevel = 0;
  focused = false;
  readonly session = Object.assign(new EventEmitter(), {
    availableSpellCheckerLanguages: [],
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    setSpellCheckerLanguages: () => {},
  });
  readonly navigationHistory = { goBack: () => {}, goForward: () => {} };

  send(channel: string, value?: unknown) {
    this.sent.push([channel, value]);
  }
  async loadURL(url: string) {
    this.loaded.push(url);
  }
  getURL() {
    return this.loaded.at(-1) ?? "";
  }
  // Chromium's zoom: each level is a factor of 1.2.
  getZoomFactor() {
    return 1.2 ** this.zoomLevel;
  }
  getZoomLevel() {
    return this.zoomLevel;
  }
  setZoomLevel(level: number) {
    this.zoomLevel = level;
  }
  focus() {
    this.focused = true;
  }
  isDestroyed() {
    return false;
  }
  getUserAgent() {
    return "Mozilla/5.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36";
  }
  setUserAgent() {}
  setWindowOpenHandler() {}
  insertCSS() {}
  stopFindInPage() {}
  findInPage() {}
  close() {}
}

export class BrowserWindow extends EventEmitter {
  static readonly all: Array<BrowserWindow> = [];
  static getAllWindows() {
    return BrowserWindow.all.filter((w) => !w.closed);
  }
  readonly webContents = new FakeContents();
  readonly contentView = { addChildView: () => {} };
  closed = false;
  constructor() {
    super();
    BrowserWindow.all.push(this);
  }
  getContentBounds() {
    return { x: 0, y: 0, width: 1440, height: 920 };
  }
  isDestroyed() {
    return this.closed;
  }
  show() {}
  close() {
    this.closed = true;
    this.emit("closed");
  }
}

export class WebContentsView {
  static readonly all: Array<WebContentsView> = [];
  readonly webContents = new FakeContents();
  bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  constructor() {
    WebContentsView.all.push(this);
  }
  setBackgroundColor() {}
  setBounds(bounds: Rect) {
    this.bounds = bounds;
  }
  getBounds() {
    return this.bounds;
  }
}

class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, (event: unknown, ...args: Array<unknown>) => unknown>();
  handle(channel: string, handler: (event: unknown, ...args: Array<unknown>) => unknown) {
    this.handlers.set(channel, handler);
  }
  /** `ipcRenderer.send` from `sender`. */
  sendFrom(sender: unknown, channel: string, value?: unknown) {
    this.emit(channel, { sender }, value);
  }
  /** `ipcRenderer.sendSync` from `sender`: what main put in `returnValue`. */
  sendSyncFrom(sender: unknown, channel: string): unknown {
    const event: { sender: unknown; returnValue?: unknown } = { sender };
    this.emit(channel, event);
    return event.returnValue;
  }
  /** `ipcRenderer.invoke` from `sender`. */
  async invokeFrom(sender: unknown, channel: string, value?: unknown): Promise<unknown> {
    return this.handlers.get(channel)?.({ sender }, value);
  }
}
export const ipcMain = new FakeIpcMain();

const userData = { path: "" };
export const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  relaunched: 0,
  quits: 0,
  commandLine: { appendSwitch: () => {} },
  getPath: (name: string) => (name === "userData" ? userData.path : `/tmp/fake-${name}`),
  setPath: (name: string, value: string) => {
    if (name === "userData") userData.path = value;
  },
  getPreferredSystemLanguages: () => ["en-US"],
  setAsDefaultProtocolClient: () => {},
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  relaunch() {
    this.relaunched++;
  },
  quit() {
    this.quits++;
  },
});

export const Menu = { buildFromTemplate: () => ({ popup: () => {} }) };
export const shell = { openExternal: async () => {} };
export const clipboard = { writeText: () => {} };

/** Forgets every listener, window and count, so the next test boots main.ts on a clean Electron. */
export const reset = () => {
  ipcMain.removeAllListeners();
  ipcMain.handlers.clear();
  app.removeAllListeners();
  app.relaunched = 0;
  app.quits = 0;
  BrowserWindow.all.length = 0;
  WebContentsView.all.length = 0;
};
