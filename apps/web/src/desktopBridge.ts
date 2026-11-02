import type { EngineBatch, XSkinToggle } from "@xtend/contracts";

/**
 * What the Electron preload exposes to the web app. Kept here rather than in
 * contracts because only the desktop shell and this UI ever see it.
 */

/** Keys main caught for the app: ⌘K palette, ⌘\ X panel, ⌘F find, ⌘R or F5 refresh. */
export type ShortcutKey = "palette" | "xPanel" | "find" | "refresh";

interface SessionDownload {
  readonly name: string;
  readonly state: "started" | "completed" | "failed";
}

/** What the x.com composer chip shows; the app computes and formats it. */
export interface Glance {
  readonly queued: number;
  readonly nextScheduled: string | null;
  readonly bestTime: string | null;
  readonly mentions: number;
  readonly spendTodayUsd: number;
  readonly connected: boolean;
}

type UpdateChannel = "stable" | "nightly";

/** The desktop's own update; mirrors `UpdateState` in apps/desktop/src/ipc/channels.ts. */
export type UpdateState = { readonly channel: UpdateChannel; readonly version: string } & (
  | { readonly status: "idle" }
  | { readonly status: "available"; readonly next: string; readonly url: string }
  | { readonly status: "downloading"; readonly next: string; readonly percent: number }
  | { readonly status: "ready"; readonly next: string }
  | { readonly status: "error"; readonly message: string }
);

export type ServiceMode = "child" | "launchd" | "remote" | "none";

interface RemoteConfig {
  readonly url: string;
  readonly token: string;
}

export interface Reachability {
  readonly health: boolean;
  readonly version: string | null;
  readonly auth: boolean;
  readonly error: string | null;
}

export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  /** The service token the desktop holds; the page uses it instead of asking the service. */
  readonly serviceToken: string;
  /** How the desktop found its service: spawned child, launchd agent, remote URL, or something else local. */
  readonly serviceMode: ServiceMode;
  /** The remote service the desktop is pointed at, if any. */
  readonly remote: RemoteConfig | null;
  /** The account whose x.com session the window opened. */
  readonly accountId: number;
  /** The cookie partition the x.com webview must use; main refuses any other. */
  readonly xPartition: string;
  /** Where x.com was when the app last closed. */
  readonly xStartUrl: string;
  /** A route asked for before the page loaded (a deep link at launch). */
  readonly initialRoute: string | null;
  readonly checkRemote: (config: RemoteConfig) => Promise<Reachability>;
  /** Saves the remote (null returns to the local service) and relaunches the app. */
  readonly setRemote: (config: RemoteConfig | null) => void;
  /** Rebuilds the window on the account's own session partition. */
  readonly selectAccount: (id: number) => void;
  /** Hands main the summary the x.com composer chip draws. */
  readonly pushGlance: (glance: Glance) => void;
  /** Rebuilds the X skin (CSS only) in the webview from the enabled Clean X toggles. */
  readonly setXSkin: (on: ReadonlyArray<XSkinToggle>) => void;
  readonly openExternal: (url: string) => void;
  /** The OS emoji picker over the focused field; nothing where the OS has none (Linux). */
  readonly showEmojiPanel: () => void;
  /** Routes asked for from outside the page: deep links and the x.com injections. */
  readonly onAppRoute: (cb: (route: string) => void) => () => void;
  readonly onSessionDownload: (cb: (download: SessionDownload) => void) => () => void;
  readonly onShortcut: (cb: (key: ShortcutKey) => void) => () => void;
  readonly getUpdate: () => Promise<UpdateState>;
  readonly onUpdate: (cb: (state: UpdateState) => void) => () => void;
  /** Each response the X engine received, as posts Xtend's own X screens draw. */
  readonly onEngine: (cb: (batch: EngineBatch) => void) => () => void;
  readonly checkUpdate: () => void;
  /** Follows another channel from now on, and checks it at once. */
  readonly setUpdateChannel: (channel: UpdateChannel) => void;
  /** Quits and installs a downloaded update; does nothing before one is ready. */
  readonly restartToUpdate: () => void;
}
