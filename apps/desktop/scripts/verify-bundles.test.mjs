import * as NodeFS from "node:fs";
import { expect, it } from "vite-plus/test";

import {
  bridgeApis,
  overlayChannels,
  verifyAppPreload,
  verifyOverlayPreload,
} from "./verify-bundles.mjs";

const read = (path) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");

it("reads the bridge functions and the overlay channels from their sources", () => {
  const apis = bridgeApis(read("../../web/src/desktopBridge.ts"));
  expect(apis).toContain("setXSkin");
  expect(apis).toContain("pushGlance");
  // Data members are not functions the preload has to expose.
  expect(apis).not.toContain("serviceToken");
  const channels = overlayChannels(read("../src/ipc/channels.ts"));
  expect(channels).toContain("xtend:overlay-data");
  expect(channels).not.toContain("xtend:overlay-action");
});

it("passes a sandbox-safe preload and names what a broken one lacks", () => {
  const good = `const { contextBridge, ipcRenderer } = require("electron");
    contextBridge.exposeInMainWorld("desktopBridge", { openSlot: () => {} });
    ipcRenderer.on("xtend:overlay-data", () => {});`;
  expect(() => verifyAppPreload(good, ["openSlot"])).not.toThrow();
  expect(() => verifyOverlayPreload(good, ["xtend:overlay-data"])).not.toThrow();
  expect(() => verifyAppPreload(good, ["openSlot", "closeSlot"])).toThrow(/missing: closeSlot/);
  expect(() => verifyOverlayPreload(good, ["xtend:overlay-glance"])).toThrow(/overlay-glance/);
});

it("rejects a preload that requires anything a sandboxed preload cannot load", () => {
  const chunk = `require("./shared-chunk.cjs");`;
  expect(() => verifyAppPreload(chunk, [])).toThrow(/shared-chunk.cjs/);
  expect(() => verifyAppPreload(`require("effect/Effect");`, [])).toThrow(/effect\/Effect/);
});
