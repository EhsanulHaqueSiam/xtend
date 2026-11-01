import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  APP_ROUTE_CHANNEL,
  BRIDGE_INFO_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_VIEWER_CHANNEL,
} from "../ipc/channels.ts";
import { FakeContents, ipcMain, session, shell } from "../testing/fakeElectron.ts";
import { createMainWindow, type MainWindowOptions } from "./MainWindow.ts";

vi.mock("electron", () => import("../testing/fakeElectron.ts"));
// Capture and commands talk to CDP and the service; neither is what these tests are about.
vi.mock("../xSession/SessionCapture.ts", () => ({ attachSessionCapture: () => () => {} }));
vi.mock("../service/DesktopCommands.ts", () => ({
  attachDesktopCommands: () => ({ save: () => {}, detach: () => {} }),
}));

const open = (extra: Partial<MainWindowOptions> = {}) => {
  const main = createMainWindow({
    appUrl: "http://127.0.0.1:4820",
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "secret",
    accountId: 1,
    bridgeInfo: { serviceToken: "secret", serviceMode: "child", remote: null, accountId: 1 },
    queueDir: NodePath.join(NodeOS.tmpdir(), "xtend-test-queue"),
    sessionUrlFile: NodePath.join(NodeOS.tmpdir(), "xtend-test-no-session-url"),
    log: () => {},
    ...extra,
  });
  const app = main.appContents as unknown as FakeContents;
  // The page's <webview> attaching, as Electron reports it to the embedder.
  const x = new FakeContents();
  app.emit("did-attach-webview", {}, x);
  return { main, app, x };
};

let close = () => {};
afterEach(() => {
  close();
  close = () => {};
});

it("hands the service token only to the app page, and stops listening once the window closes", () => {
  const { main, app, x } = open();
  expect(ipcMain.sendSyncFrom(x, BRIDGE_INFO_CHANNEL)).toBeUndefined();
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toMatchObject({
    serviceToken: "secret",
    xPartition: "persist:x-session",
    initialRoute: null,
  });
  main.window.close();
  // An account switch rebuilds the window; the old one's handlers must not pile up.
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toBeUndefined();
  for (const channel of [OVERLAY_ACTION_CHANNEL, OVERLAY_VIEWER_CHANNEL])
    expect(ipcMain.listenerCount(channel)).toBe(0);
});

it("passes the x.com preload's routes to the app, only app paths and only from the webview", () => {
  const { main, app, x } = open();
  close = () => main.window.close();
  ipcMain.sendFrom(app, OVERLAY_ACTION_CHANNEL, { type: "openRoute", route: "/plan" });
  ipcMain.sendFrom(new FakeContents(), OVERLAY_ACTION_CHANNEL, {
    type: "openRoute",
    route: "/plan",
  });
  ipcMain.sendFrom(x, OVERLAY_ACTION_CHANNEL, { type: "openRoute", route: "https://evil.example" });
  expect(app.sent.filter(([c]) => c === APP_ROUTE_CHANNEL)).toEqual([]);

  ipcMain.sendFrom(x, OVERLAY_ACTION_CHANNEL, { type: "openRoute", route: "/compose?reply=9" });
  expect(app.sent).toContainEqual([APP_ROUTE_CHANNEL, "/compose?reply=9"]);
});

it("refuses a webview that is not x.com on this account's partition, and hardens the one it allows", () => {
  const { main, app } = open();
  close = () => main.window.close();
  const attach = (params: Record<string, string>) => {
    const prefs: Record<string, unknown> = { preload: "/tmp/theirs.js", nodeIntegration: true };
    let refused = false;
    app.emit("will-attach-webview", { preventDefault: () => (refused = true) }, prefs, params);
    return { refused, prefs };
  };
  expect(attach({ src: "https://example.com/", partition: "persist:x-session" }).refused).toBe(
    true,
  );
  expect(attach({ src: "https://x.com/home", partition: "persist:x-session-2" }).refused).toBe(
    true,
  );
  const allowed = attach({ src: "https://x.com/home", partition: "persist:x-session" });
  expect(allowed.refused).toBe(false);
  expect(allowed.prefs).toMatchObject({ nodeIntegration: false, sandbox: true });
  expect(String(allowed.prefs.preload)).toMatch(/overlayPreload\.cjs$/);
});

it("skins x.com on every load and zooms it from the keyboard", async () => {
  const { main, x } = open();
  close = () => main.window.close();
  x.emit("dom-ready");
  await vi.waitFor(() => expect(x.insertedCss).toHaveLength(1));

  const mod = process.platform === "darwin" ? { meta: true } : { control: true };
  const press = (key: string) =>
    x.emit(
      "before-input-event",
      { preventDefault: () => {} },
      { type: "keyDown", key, code: "", alt: false, shift: false, isAutoRepeat: false, ...mod },
    );
  press("=");
  expect(x.zoomLevel).toBe(0.5);
  press("0");
  expect(x.zoomLevel).toBe(0);
});

it("loads desktop recovery when the app cannot load and retries only for its renderer", async () => {
  const { main, app, x } = open();
  close = () => main.window.close();
  const { RECOVERY_RETRY_CHANNEL } = await import("../ipc/channels.ts");
  await vi.waitFor(() => expect(app.loaded).toHaveLength(1));
  app.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://127.0.0.1:4820", false);
  expect(app.loaded).toHaveLength(1);
  app.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "http://127.0.0.1:4820", true);
  await vi.waitFor(() => expect(app.loaded).toHaveLength(2));
  const html = decodeURIComponent(app.loaded[1]!.split(",").slice(1).join(","));
  expect(html).toContain("Can't reach the service");
  expect(html).not.toContain("secret");
  ipcMain.sendFrom(x, RECOVERY_RETRY_CHANNEL);
  expect(app.loaded).toHaveLength(2);
  main.openRoute("/compose?text=hello");
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toMatchObject({ initialRoute: null });
  ipcMain.sendFrom(app, RECOVERY_RETRY_CHANNEL);
  await vi.waitFor(() => expect(app.loaded).toHaveLength(3));
  expect(app.loaded[2]).toBe("http://127.0.0.1:4820");
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toMatchObject({
    initialRoute: "/compose?text=hello",
  });
});

it("handles the initial load rejection with a bundled recovery page", async () => {
  vi.spyOn(FakeContents.prototype, "loadURL").mockRejectedValueOnce(
    new Error("connection refused"),
  );
  const { main, app } = open();
  close = () => main.window.close();
  await vi.waitFor(() => expect(app.loaded.at(-1)).toMatch(/^data:text\/html/));
  vi.restoreAllMocks();
});

it("shows recovery after ten seconds when the app load hangs", async () => {
  vi.useFakeTimers();
  let rejectLoad = (_error: Error) => {};
  vi.spyOn(FakeContents.prototype, "loadURL").mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  );
  vi.spyOn(FakeContents.prototype, "stop").mockImplementation(() =>
    rejectLoad(new Error("aborted")),
  );
  try {
    const { main, app } = open();
    close = () => main.window.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(app.loaded.at(-1)).toMatch(/^data:text\/html/);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it("takes the screen when X's video goes fullscreen, and gives it back only if the video took it", () => {
  const { main, x } = open();
  close = () => main.window.close();
  const win = main.window;
  x.emit("enter-html-full-screen");
  expect(win.isFullScreen()).toBe(true);
  x.emit("leave-html-full-screen");
  expect(win.isFullScreen()).toBe(false);

  // Already fullscreen by the user's choice: leaving the video keeps it.
  win.setFullScreen(true);
  x.emit("enter-html-full-screen");
  x.emit("leave-html-full-screen");
  expect(win.isFullScreen()).toBe(true);
});

it("on mock X, opens nothing in the system browser and imports no X cookies", async () => {
  const cookieFile = NodePath.join(NodeOS.tmpdir(), `xtend-test-cookies-${process.pid}.json`);
  NodeFS.writeFileSync(
    cookieFile,
    JSON.stringify([{ name: "auth_token", value: "real", domain: ".x.com" }]),
  );
  const openExternal = vi.spyOn(shell, "openExternal");
  const logged: Array<string> = [];
  const { main, app, x } = open({
    mockX: "http://127.0.0.1:4830",
    importCookiesPath: cookieFile,
    log: (message) => void logged.push(message),
  });
  close = () => {
    main.window.close();
    openExternal.mockRestore();
    NodeFS.rmSync(cookieFile, { force: true });
  };
  // A card's link from mock X's page, a link in the app, and the app's own "open in browser".
  x.windowOpenHandler?.({ url: "https://example.com/card" });
  app.windowOpenHandler?.({ url: "https://example.com/" });
  ipcMain.sendFrom(app, OPEN_EXTERNAL_CHANNEL, "https://example.com/");
  // The app loads once the cookie step is past.
  await vi.waitFor(() => expect(app.loaded).toContain("http://127.0.0.1:4820"));
  expect(openExternal).not.toHaveBeenCalled();
  expect(logged.filter((m) => m === "mock X refused an external open")).toHaveLength(3);
  expect(NodeFS.existsSync(cookieFile)).toBe(true);
  expect(session.fromPartition("x-mock").cookies).toHaveLength(0);
});
