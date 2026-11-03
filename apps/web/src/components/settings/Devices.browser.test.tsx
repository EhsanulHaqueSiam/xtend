import "../../index.css";

import { type Device, Devices_METHODS, WS_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { SettingsScreen } from "../../routes/settings";
import { DeviceSync } from "../shell/DeviceSync";

const device = (id: string, name: string, prefs: Device["prefs"]): Device => ({
  id,
  name,
  paired: true,
  createdAt: "2026-11-03T08:00:00.000Z",
  lastSeenAt: "2026-11-03T08:00:00.000Z",
  prefs,
});

const MINI = device("mini-0001", "Mac mini", { cleanX: ["ads"], updateChannel: "stable" });
const LAPTOP = device("laptop-001", "MacBook", {
  cleanX: ["ads", "grok"],
  updateChannel: "nightly",
});

const INFO = {
  name: "xtend" as const,
  version: "0.0.1",
  baseDir: "/x",
  host: "100.64.0.1",
  supervisor: "launchd" as const,
};

it("edits the Clean X of the device picked in Settings for, each switch on top of the last", async () => {
  const updates: Array<unknown> = [];
  await using screen = await render(<SettingsScreen />, {
    router: "/settings?tab=x",
    service: {
      [WS_METHODS.serverInfo]: () => Effect.succeed(INFO),
      [Devices_METHODS.list]: () => Effect.succeed([MINI, LAPTOP]),
      [Devices_METHODS.update]: (input) => {
        updates.push(input);
        return Effect.succeed(LAPTOP);
      },
    },
  });
  await userEvent.click(screen.getByRole("combobox", { name: "Settings for" }));
  await userEvent.click(page.getByRole("option", { name: "MacBook" }));
  await expect.element(screen.getByText(/^MacBook only\./)).toBeVisible();

  // The fake never refetches, as when a second switch beats the first write's event.
  await userEvent.click(screen.getByRole("switch", { name: "Hide Grok" }));
  await userEvent.click(screen.getByRole("switch", { name: "Hide ads" }));
  expect(updates).toEqual([
    { id: "laptop-001", prefs: { cleanX: ["ads"], updateChannel: "nightly" } },
    { id: "laptop-001", prefs: { cleanX: [], updateChannel: "nightly" } },
  ]);

  // The MacBook's picks still wait on the service; the Mac mini starts from its own list.
  await userEvent.click(screen.getByRole("combobox", { name: "Settings for" }));
  await userEvent.click(page.getByRole("option", { name: "Mac mini" }));
  await userEvent.click(screen.getByRole("switch", { name: "Hide Grok" }));
  expect(updates.at(-1)).toEqual({
    id: "mini-0001",
    prefs: { cleanX: ["ads", "grok"], updateChannel: "stable" },
  });
});

it("a desktop says hello with what it had, then follows the prefs the service holds for it", async () => {
  const fake = installFakeBridge({
    device: { id: "laptop-001", name: "MacBook" },
    getUpdate: () => Promise.resolve({ channel: "stable", version: "0.0.1", status: "idle" }),
  });
  onTestFinished(() => {
    delete window.desktopBridge;
  });
  localStorage.setItem("xtend:x-skin-toggles", "views");
  const hellos: Array<unknown> = [];
  await using _screen = await render(<DeviceSync />, {
    service: {
      [Devices_METHODS.list]: () => Effect.succeed([LAPTOP]),
      [Devices_METHODS.hello]: (input) => {
        hellos.push(input);
        return Effect.succeed(LAPTOP);
      },
    },
  });
  await expect
    .poll(() => hellos)
    .toEqual([
      { id: "laptop-001", name: "MacBook", prefs: { cleanX: ["views"], updateChannel: "stable" } },
    ]);
  await expect.poll(() => fake.calls).toContain("update channel nightly");
  await expect.poll(() => localStorage.getItem("xtend:x-skin-toggles")).toBe("ads,grok");
});
