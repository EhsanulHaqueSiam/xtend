import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, it } from "vite-plus/test";

import type { UpdateState } from "./ipc/channels.ts";
import { startUpdates, type Updater } from "./updates.ts";

/**
 * electron-updater's surface, driven by hand: `emit` plays its events, and with `hold` the next
 * check (with its download) stays running until `settle`.
 */
const fakeUpdater = () => {
  const handlers = new Map<string, (value: never) => void>();
  let checks = 0;
  let installs = 0;
  let held = false;
  let settle = () => {};
  const updater: Updater = {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: () => {
      checks++;
      if (!held) return Promise.resolve(null);
      held = false;
      return new Promise((resolve) => (settle = () => resolve(null)));
    },
    quitAndInstall: () => void installs++,
    on: (event: string, cb: (value: never) => void) => void handlers.set(event, cb),
  };
  return {
    updater,
    emit: (event: string, value?: unknown) => handlers.get(event)?.(value as never),
    checks: () => checks,
    installs: () => installs,
    hold: () => void (held = true),
    settle: () => settle(),
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve));

const start = (version: string, platform: NodeJS.Platform, fake = fakeUpdater()) => {
  const seen: Array<UpdateState> = [];
  const channelFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xtend-updates-")), "u.json");
  const updates = startUpdates({
    updater: fake.updater,
    version,
    platform,
    channelFile,
    broadcast: (s) => seen.push(s),
    log: () => {},
  });
  return { ...fake, updates, seen, channelFile };
};

it("follows the build's own channel, downloads on Linux and restarts only once ready", () => {
  const run = start("0.0.3-nightly.20261030.7", "linux");
  expect(run.updater.channel).toBe("nightly");
  expect(run.updater.allowPrerelease).toBe(true);
  expect(run.checks()).toBe(1);

  run.updates.restart();
  expect(run.installs()).toBe(0);
  run.emit("update-available", { version: "0.0.3-nightly.20261030.9" });
  run.emit("download-progress", { percent: 41.6 });
  expect(run.updates.state).toMatchObject({ status: "downloading", percent: 42 });
  run.emit("update-downloaded", { version: "0.0.3-nightly.20261030.9" });
  expect(run.seen.at(-1)).toMatchObject({ status: "ready", next: "0.0.3-nightly.20261030.9" });
  run.updates.restart();
  expect(run.installs()).toBe(1);
  run.updates.stop();
});

it("links unsigned macOS builds to the release instead of downloading", () => {
  const run = start("0.0.2", "darwin");
  expect(run.updater.channel).toBe("latest");
  expect(run.updater.autoDownload).toBe(false);
  run.emit("update-available", { version: "0.0.3" });
  expect(run.updates.state).toMatchObject({
    status: "available",
    url: "https://github.com/EhsanulHaqueSiam/xtend/releases/tag/v0.0.3",
  });
  run.updates.stop();
});

it("saves a channel switch, allows the step down to stable, and checks again", async () => {
  const run = start("0.0.3-nightly.20261030.7", "linux");
  run.updates.setChannel("stable");
  await flush();
  expect(run.updater.channel).toBe("latest");
  expect(run.updater.allowDowngrade).toBe(true);
  expect(run.checks()).toBe(2);
  expect(JSON.parse(fs.readFileSync(run.channelFile, "utf8"))).toEqual({ channel: "stable" });
  run.updates.stop();
});

it("drops what a running check finds for the old channel and switches once it settles", async () => {
  const fake = fakeUpdater();
  fake.hold();
  const run = start("0.0.3", "linux", fake);
  run.updates.setChannel("nightly");
  run.emit("update-available", { version: "0.0.4" });
  expect(run.updates.state.status).toBe("idle");
  expect(run.updater.channel).toBe("latest");

  run.settle();
  await flush();
  expect(run.updater.channel).toBe("nightly");
  expect(run.checks()).toBe(2);
  run.updates.stop();
});

it("never readies a nightly that was downloading when the user switched to stable", async () => {
  const run = start("0.0.3", "linux");
  run.updates.setChannel("nightly");
  await flush();
  run.hold();
  run.updates.check();
  run.emit("update-available", { version: "0.0.4-nightly.20261030.9" });
  run.updates.setChannel("stable");
  run.emit("update-downloaded", { version: "0.0.4-nightly.20261030.9" });
  expect(run.updates.state.status).toBe("idle");
  expect(run.updater.autoInstallOnAppQuit).toBe(false);
  run.updates.restart();
  expect(run.installs()).toBe(0);

  run.settle();
  await flush();
  expect(run.updater.channel).toBe("latest");
  expect(run.checks()).toBe(4);
  run.updates.stop();
});
