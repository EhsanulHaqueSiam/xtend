import * as fs from "node:fs";

import type { UpdateChannel, UpdateState, UpdateStatus } from "./ipc/channels.ts";

/** Nightlies are `X.Y.Z-nightly.YYYYMMDD.N` (see .github/workflows/release-desktop.yml). */
const isNightly = (version: string) => /-nightly\./.test(version);

/** A build follows the channel it came from until the user picks the other one. */
export const defaultChannel = (version: string): UpdateChannel =>
  isNightly(version) ? "nightly" : "stable";

const releaseUrl = (version: string) =>
  `https://github.com/EhsanulHaqueSiam/xtend/releases/tag/v${version}`;

/** The saved channel, or the build's own; a missing or garbled file is the build's. */
const readChannel = (file: string, version: string): UpdateChannel => {
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof saved === "object" && saved !== null && "channel" in saved) {
      if (saved.channel === "stable" || saved.channel === "nightly") return saved.channel;
    }
  } catch {}
  return defaultChannel(version);
};

/** The slice of electron-updater this module drives, so tests can stand in for it. */
export interface Updater {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(
    event: "update-available" | "update-downloaded",
    cb: (info: { version: string }) => void,
  ): void;
  on(event: "update-not-available", cb: () => void): void;
  on(event: "download-progress", cb: (progress: { percent: number }) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Background updates, the way T3 Code's desktop does them: a stable and a nightly channel off
 * GitHub Releases, a check at start and every hour, and the app shows "Restart to update" once a
 * build is downloaded. macOS builds are unsigned, and Squirrel.Mac refuses to install into an
 * unsigned app, so there the app links to the release instead of downloading.
 */
export function startUpdates(options: {
  readonly updater: Updater;
  readonly version: string;
  readonly platform: NodeJS.Platform;
  readonly channelFile: string;
  readonly broadcast: (state: UpdateState) => void;
  readonly log: (message: string, detail?: unknown) => void;
}) {
  const { updater, version } = options;
  // shortcut: macOS stays on "Download" until the build is signed; drop this once CSC_LINK is set.
  const canInstall = options.platform !== "darwin";
  let channel = readChannel(options.channelFile, version);
  let state: UpdateState = { channel, version, status: "idle" };
  const set = (next: UpdateStatus) => {
    state = { ...next, channel, version };
    options.broadcast(state);
  };

  const configure = () => {
    // electron-updater calls stable "latest"; nightly also needs prereleases in view.
    updater.channel = channel === "nightly" ? "nightly" : "latest";
    updater.allowPrerelease = channel === "nightly";
    // Leaving nightly for stable is a step down in version; the user asked for it.
    updater.allowDowngrade = channel === "stable" && isNightly(version);
    updater.autoDownload = canInstall;
  };
  configure();

  updater.on("update-available", (info) =>
    set(
      canInstall
        ? { status: "downloading", next: info.version, percent: 0 }
        : { status: "available", next: info.version, url: releaseUrl(info.version) },
    ),
  );
  updater.on("download-progress", (progress) => {
    if (state.status === "downloading")
      set({ status: "downloading", next: state.next, percent: Math.round(progress.percent) });
  });
  updater.on("update-downloaded", (info) => set({ status: "ready", next: info.version }));
  updater.on("update-not-available", () => set({ status: "idle" }));
  updater.on("error", (error) => {
    options.log("updater", String(error));
    // A failed download leaves the running build in place: say so once, check again next hour.
    if (state.status !== "ready") set({ status: "error", message: error.message.slice(0, 200) });
  });

  const check = () => {
    if (state.status === "ready" || state.status === "downloading") return;
    // The error listener already reported a rejection.
    updater.checkForUpdates()?.catch(() => {});
  };
  check();
  const timer = setInterval(check, HOUR_MS);

  return {
    get state() {
      return state;
    },
    check,
    setChannel: (next: UpdateChannel) => {
      if (next === channel) return;
      channel = next;
      try {
        fs.writeFileSync(options.channelFile, JSON.stringify({ channel }));
      } catch (error) {
        options.log("update channel not saved", String(error));
      }
      configure();
      set({ status: "idle" });
      check();
    },
    restart: () => {
      if (state.status === "ready") updater.quitAndInstall();
    },
    stop: () => clearInterval(timer),
  };
}
