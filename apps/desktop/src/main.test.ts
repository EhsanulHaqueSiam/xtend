import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  ACCOUNT_SELECT_CHANNEL,
  REMOTE_CHECK_CHANNEL,
  REMOTE_SET_CHANNEL,
} from "./ipc/channels.ts";

vi.mock("electron", () => import("./testing/fakeElectron.ts"));
vi.mock("electron-updater", () => ({ autoUpdater: {} }));
vi.mock("./tray.ts", () => ({ createTray: () => {} }));
const supervisor = vi.hoisted(() => ({ ready: Promise.resolve() }));
vi.mock("./service/ServiceSupervisor.ts", () => ({
  superviseService: async () => {
    await supervisor.ready;
    return { mode: "child", stop: () => {} };
  },
}));
vi.mock("./window/MainWindow.ts", async () => {
  const { BrowserWindow, FakeContents } = await import("./testing/fakeElectron.ts");
  return {
    createMainWindow: vi.fn((options: { accountId: number }) => ({
      accountId: options.accountId,
      window: new BrowserWindow(),
      appContents: new FakeContents(),
      openRoute: vi.fn(),
    })),
  };
});

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "xtend-main-"));
  vi.stubEnv("XTEND_USER_DATA", path.join(home, "user-data"));
  vi.stubEnv("XTEND_HOME", path.join(home, "service"));
  vi.stubEnv("XTEND_SERVICE_TOKEN", "tok");
  vi.stubEnv("XTEND_SERVICE_URL", undefined);
  vi.stubGlobal("fetch", async () => Response.json({ currentId: 1 }));
  fs.mkdirSync(path.join(home, "user-data"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

type FakeElectron = typeof import("./testing/fakeElectron.ts");
interface OpenedWindow {
  readonly accountId: number;
  readonly window: InstanceType<FakeElectron["BrowserWindow"]>;
  readonly appContents: InstanceType<FakeElectron["FakeContents"]>;
  readonly openRoute: ReturnType<typeof vi.fn>;
}

/** Starts main.ts afresh; `windows()` are the windows it opened, oldest first. */
const boot = async () => {
  vi.resetModules();
  // Mocked modules outlive resetModules: take the instance main.ts gets, and clear it.
  const electron = (await import("electron")) as unknown as FakeElectron;
  electron.reset();
  const { createMainWindow } = await import("./window/MainWindow.ts");
  vi.mocked(createMainWindow).mockClear();
  await import("./main.ts");
  const windows = () =>
    vi.mocked(createMainWindow).mock.results.map((r) => r.value as OpenedWindow);
  return { ...electron, windows };
};

it("lets only the app view repoint the service, and only at a URL it can start with", async () => {
  const { app, ipcMain, FakeContents, windows } = await boot();
  await vi.waitFor(() => expect(windows()).toHaveLength(1));
  const [first] = windows();
  const x = first!.window.webContents;
  const configFile = path.join(home, "user-data", "config.json");
  const remote = { url: "http://mini.tail.ts.net:4820", token: "theirs" };

  ipcMain.sendFrom(x, REMOTE_SET_CHANNEL, remote);
  ipcMain.sendFrom(new FakeContents(), REMOTE_SET_CHANNEL, remote);
  await expect(ipcMain.invokeFrom(x, REMOTE_CHECK_CHANNEL, remote)).rejects.toThrow();
  ipcMain.sendFrom(first!.appContents, REMOTE_SET_CHANNEL, { url: "mini:4820", token: "theirs" });
  expect(fs.existsSync(configFile)).toBe(false);
  expect(app.relaunched).toBe(0);

  ipcMain.sendFrom(first!.appContents, REMOTE_SET_CHANNEL, remote);
  expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ remote });
  expect([app.relaunched, app.quits]).toEqual([1, 1]);
});

it("switches accounts from the current window only, however many times", async () => {
  const { ipcMain, windows } = await boot();
  await vi.waitFor(() => expect(windows()).toHaveLength(1));
  const [first] = windows();
  ipcMain.sendFrom(first!.window.webContents, ACCOUNT_SELECT_CHANNEL, 2);
  expect(windows()).toHaveLength(1);

  ipcMain.sendFrom(first!.appContents, ACCOUNT_SELECT_CHANNEL, 2);
  const second = windows()[1]!;
  expect(second.accountId).toBe(2);
  expect(first!.window.closed).toBe(true);
  // The old window closing after the new one opened must not make main forget the new one.
  ipcMain.sendFrom(second.appContents, ACCOUNT_SELECT_CHANNEL, 3);
  expect(windows().map((w) => w.accountId)).toEqual([1, 2, 3]);
  ipcMain.sendFrom(first!.appContents, ACCOUNT_SELECT_CHANNEL, 4);
  expect(windows()).toHaveLength(3);
});

it("opens a deep link that arrived before the service answered once the window is up", async () => {
  let answer = () => {};
  supervisor.ready = new Promise((resolve) => (answer = resolve));
  const { app, windows } = await boot();
  app.emit("open-url", { preventDefault: () => {} }, "xtend://compose?text=hello");
  expect(windows()).toHaveLength(0);

  answer();
  await vi.waitFor(() => expect(windows()).toHaveLength(1));
  expect(windows()[0]!.openRoute).toHaveBeenCalledWith("/compose?text=hello");
  supervisor.ready = Promise.resolve();
});

it("sends each service only its own token: the saved remote's to the remote, the base dir's to an explicit URL", async () => {
  vi.stubEnv("XTEND_SERVICE_TOKEN", undefined);
  const remote = { url: "http://mini.tail.ts.net:4820", token: "theirs" };
  fs.writeFileSync(path.join(home, "user-data", "config.json"), JSON.stringify({ remote }));
  fs.mkdirSync(path.join(home, "service"));
  fs.writeFileSync(path.join(home, "service", "auth-token"), "ours\n");
  const { createMainWindow } = await import("./window/MainWindow.ts");
  const opened = async () => {
    await vi.waitFor(() => expect(createMainWindow).toHaveBeenCalledTimes(1));
    return vi.mocked(createMainWindow).mock.calls[0]![0];
  };

  await boot();
  expect(await opened()).toMatchObject({
    serviceUrl: remote.url,
    serviceToken: "theirs",
    bridgeInfo: { remote },
  });

  // A dev desktop shares the installed app's user data, saved remote included.
  vi.stubEnv("XTEND_SERVICE_URL", "http://127.0.0.1:5999");
  await boot();
  expect(await opened()).toMatchObject({
    serviceUrl: "http://127.0.0.1:5999",
    serviceToken: "ours",
    bridgeInfo: { remote: null },
  });
});
