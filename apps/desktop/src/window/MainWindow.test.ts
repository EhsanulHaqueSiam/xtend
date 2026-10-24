import * as os from "node:os";
import * as path from "node:path";

import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  BRIDGE_INFO_CHANNEL,
  COLUMN_RECT_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  POINTER_DOWN_CHANNEL,
  SLOT_CHANNEL,
  SLOT_OPEN_CHANNEL,
} from "../ipc/channels.ts";
import { type FakeContents, ipcMain, WebContentsView } from "../testing/fakeElectron.ts";
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
  const view = WebContentsView.all.at(-1)!;
  const x = main.window.webContents as unknown as FakeContents;
  return { main, x, app: main.appContents as unknown as FakeContents, view };
};

let close = () => {};
afterEach(() => {
  close();
  close = () => {};
});

it("hands the service token only to the app view, and stops listening once the window closes", () => {
  const { main, x, app } = open();
  expect(ipcMain.sendSyncFrom(x, BRIDGE_INFO_CHANNEL)).toBeUndefined();
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toMatchObject({
    serviceToken: "secret",
    slot: { kind: null, route: "/" },
  });
  main.window.close();
  // An account switch rebuilds the window; the old one's handlers must not pile up.
  expect(ipcMain.sendSyncFrom(app, BRIDGE_INFO_CHANNEL)).toBeUndefined();
  for (const channel of [SLOT_OPEN_CHANNEL, COLUMN_RECT_CHANNEL, OVERLAY_ACTION_CHANNEL])
    expect(ipcMain.listenerCount(channel)).toBe(0);
});

it("opens slots for the app view and the x.com preload's own actions, nobody else", () => {
  const { main, x, app, view } = open();
  close = () => main.window.close();
  const plan = { kind: "center", route: "/plan" };
  ipcMain.sendFrom(x, SLOT_OPEN_CHANNEL, plan);
  ipcMain.sendFrom(app, OVERLAY_ACTION_CHANNEL, { type: "openSlot", slot: plan });
  ipcMain.sendFrom(x, OVERLAY_ACTION_CHANNEL, {
    type: "openSlot",
    slot: { kind: "center", route: "https://evil.example" },
  });
  expect(view.bounds.width).toBe(0);

  ipcMain.sendFrom(x, OVERLAY_ACTION_CHANNEL, { type: "openSlot", slot: plan });
  expect(view.bounds).toEqual({ x: 420, y: 0, width: 600, height: 920 });
  expect(app.sent).toContainEqual([SLOT_CHANNEL, { kind: "center", route: "/plan" }]);
  expect(app.focused).toBe(true);

  // A press anywhere in x.com closes it and hands the keyboard back to X.
  ipcMain.sendFrom(app, POINTER_DOWN_CHANNEL);
  expect(view.bounds.width).toBe(600);
  ipcMain.sendFrom(x, POINTER_DOWN_CHANNEL);
  expect(view.bounds.width).toBe(0);
  expect(x.focused).toBe(true);
});

it("draws the center slot over X's column at the zoom in effect now, even when X's rect did not change", () => {
  const { main, x, app, view } = open();
  close = () => main.window.close();
  const column = { x: 88, y: 0, width: 600, height: 900 };
  ipcMain.sendFrom(x, COLUMN_RECT_CHANNEL, { column, sidebar: null });
  ipcMain.sendFrom(app, SLOT_OPEN_CHANNEL, { kind: "center", route: "/plan" });
  expect(view.bounds).toEqual({ x: 88, y: 0, width: 600, height: 920 });

  ipcMain.sendFrom(x, POINTER_DOWN_CHANNEL);
  const mod = process.platform === "darwin" ? { meta: true } : { control: true };
  x.emit("before-input-event", { preventDefault: () => {} }, { type: "keyDown", key: "=", ...mod });
  // X's narrow layout keeps the column at the same CSS rect when zoomed, so the preload sends nothing.
  ipcMain.sendFrom(app, SLOT_OPEN_CHANNEL, { kind: "center", route: "/plan" });
  expect(view.bounds).toEqual({ x: 96, y: 0, width: 657, height: 920 });

  // A rect that is not one (NaN from a detached node) falls back to the centered column.
  ipcMain.sendFrom(x, COLUMN_RECT_CHANNEL, { column: { ...column, x: Number.NaN }, sidebar: null });
  expect(view.bounds).toEqual({ x: 420, y: 0, width: 600, height: 920 });
});
