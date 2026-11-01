import * as NodeEvents from "node:events";

/**
 * Just enough of Electron for main.ts and MainWindow.ts to run in a unit test:
 * `vi.mock("electron", () => import("../testing/fakeElectron.ts"))`. IPC goes
 * through `ipcMain` with a chosen sender, so tests can play the app page, the
 * x.com webview or a stranger.
 */

function fakeSession() {
  return Object.assign(new NodeEvents.EventEmitter(), {
    availableSpellCheckerLanguages: [],
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    setSpellCheckerLanguages: () => {},
  });
}

export class FakeContents extends NodeEvents.EventEmitter {
  readonly sent: Array<readonly [string, unknown]> = [];
  readonly loaded: Array<string> = [];
  zoomLevel = 0;
  focused = false;
  readonly session = fakeSession();
  readonly debugger = Object.assign(new NodeEvents.EventEmitter(), {
    attach: () => {},
    detach: () => {},
    isAttached: () => false,
    sendCommand: async () => ({}),
  });
  readonly insertedCss: Array<string> = [];
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
  async insertCSS(css: string) {
    this.insertedCss.push(css);
    return `css-${this.insertedCss.length}`;
  }
  async removeInsertedCSS() {}
  stop() {}
  stopFindInPage() {}
  findInPage() {}
  close() {}
}

export class BrowserWindow extends NodeEvents.EventEmitter {
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
  fullScreen = false;
  isFullScreen() {
    return this.fullScreen;
  }
  setFullScreen(on: boolean) {
    this.fullScreen = on;
  }
  isDestroyed() {
    return this.closed;
  }
  show() {}
  removeMenu() {}
  close() {
    this.closed = true;
    this.emit("closed");
  }
}

/** One fake session per partition, like Electron's. */
const sessions = new Map<string, ReturnType<typeof fakeSession>>();
export const session = {
  fromPartition: (partition: string) => {
    let found = sessions.get(partition);
    if (found === undefined) sessions.set(partition, (found = fakeSession()));
    return found;
  },
};

export const nativeTheme = { themeSource: "system" };

class FakeIpcMain extends NodeEvents.EventEmitter {
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
export const app = Object.assign(new NodeEvents.EventEmitter(), {
  isPackaged: false,
  getVersion: () => "0.0.1",
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
  sessions.clear();
};
