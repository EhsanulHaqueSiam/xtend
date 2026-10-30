import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, it } from "vite-plus/test";

import type { UpdateState } from "./ipc/channels.ts";
import { startUpdates, type Updater } from "./updates.ts";

/** electron-updater's surface, driven by hand: `emit` plays its events. */
const fakeUpdater = () => {
  const handlers = new Map<string, (value: never) => void>();
  let checks = 0;
  let installs = 0;
  const updater: Updater = {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    checkForUpdates: async () => void checks++,
    quitAndInstall: () => void installs++,
    on: (event: string, cb: (value: never) => void) => void handlers.set(event, cb),
  };
  return {
    updater,
    emit: (event: string, value?: unknown) => handlers.get(event)?.(value as never),
    checks: () => checks,
    installs: () => installs,
  };
};

const start = (version: string, platform: NodeJS.Platform) => {
  const fake = fakeUpdater();
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

it("saves a channel switch, allows the step down to stable, and checks again", () => {
  const run = start("0.0.3-nightly.20261030.7", "linux");
  run.updates.setChannel("stable");
  expect(run.updater.channel).toBe("latest");
  expect(run.updater.allowDowngrade).toBe(true);
  expect(run.checks()).toBe(2);
  expect(JSON.parse(fs.readFileSync(run.channelFile, "utf8"))).toEqual({ channel: "stable" });
  run.updates.stop();
});
