import * as os from "node:os";
import * as path from "node:path";

import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  APP_ROUTE_CHANNEL,
  BRIDGE_INFO_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_VIEWER_CHANNEL,
} from "../ipc/channels.ts";
import { FakeContents, ipcMain } from "../testing/fakeElectron.ts";
import { createMainWindow } from "./MainWindow.ts";

vi.mock("electron", () => import("../testing/fakeElectron.ts"));
// Capture and commands talk to CDP and the service; neither is what these tests are about.
vi.mock("../xSession/SessionCapture.ts", () => ({ attachSessionCapture: () => () => {} }));
vi.mock("../service/DesktopCommands.ts", () => ({
  attachDesktopCommands: () => ({ save: () => {}, detach: () => {} }),
}));

const open = () => {
  const main = createMainWindow({
    appUrl: "http://127.0.0.1:4820",
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "secret",
    accountId: 1,
    bridgeInfo: { serviceToken: "secret", serviceMode: "child", remote: null, accountId: 1 },
    queueDir: path.join(os.tmpdir(), "xtend-test-queue"),
    sessionUrlFile: path.join(os.tmpdir(), "xtend-test-no-session-url"),
    log: () => {},
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
