/** IPC between the main process, the app window's preload and the x.com webview's overlay preload. */

// App -> main
export const OPEN_EXTERNAL_CHANNEL = "xtend:open-external";
export const ACCOUNT_SELECT_CHANNEL = "xtend:account-select";
export const REMOTE_SET_CHANNEL = "xtend:remote-set";
/** invoke: checks a remote service's health and token from the main process (no CORS, no leaked token). */
export const REMOTE_CHECK_CHANNEL = "xtend:remote-check";
/** sendSync from the app preload: bridge info (incl. the service token) must not ride in argv, which `ps` shows. */
export const BRIDGE_INFO_CHANNEL = "xtend:bridge-info";
/** The app's summary for the composer chip; main forwards it to the overlay preload. */
export const GLANCE_CHANNEL = "xtend:glance";
/** Whether the X skin is on (boolean); main inserts or removes its CSS in the webview. */
export const X_SKIN_CHANNEL = "xtend:x-skin";

// Main -> app
export const SESSION_DOWNLOAD_CHANNEL = "xtend:session-download";
/** A key pressed while x.com had focus that the app acts on (`ShortcutKey`). */
export const SHORTCUT_CHANNEL = "xtend:shortcut";
/** An app route to show: deep links and the x.com injections (Reply with AI, Schedule, Full report). */
export const APP_ROUTE_CHANNEL = "xtend:app-route";

// Main -> overlay preload
export const OVERLAY_DATA_CHANNEL = "xtend:overlay-data";
export const OVERLAY_TOGGLE_CHANNEL = "xtend:overlay-toggle";
export const OVERLAY_HIDE_CHANNEL = "xtend:overlay-hide";
export const OVERLAY_GLANCE_CHANNEL = "xtend:overlay-glance";
// Overlay preload -> main
export const OVERLAY_ACTION_CHANNEL = "xtend:overlay-action";

export interface SessionDownload {
  readonly name: string;
  readonly state: "started" | "completed" | "failed";
}

/** What the main process tells the app about its service and the x.com session at load time. */
export interface BridgeInfo {
  readonly serviceToken: string;
  readonly serviceMode: "child" | "launchd" | "remote" | "none";
  readonly remote: { readonly url: string; readonly token: string } | null;
  readonly accountId: number;
  /** The cookie partition of the current account; main refuses an x.com webview on any other. */
  readonly xPartition: string;
  /** Where x.com was when the app last closed. */
  readonly xStartUrl: string;
  /** A route asked for before the page loaded (a deep link at launch); null otherwise. */
  readonly initialRoute: string | null;
}

/** Keys main catches in x.com for the app: ⌘K palette, ⌘\ X panel, ⌘F find. */
export type ShortcutKey = "palette" | "xPanel" | "find";

/** What the overlay strip needs per post; the capture already normalized all of it. */
export interface OverlayPost {
  readonly views: number | null;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
  readonly createdAt: string;
  readonly authorHandle: string;
  readonly authorFollowers: number | null;
  readonly authorVerified: boolean;
  readonly isOwn: boolean;
  readonly isPromoted: boolean;
}

export interface OverlayData {
  readonly posts: Readonly<Record<string, OverlayPost>>;
  /** Mean views and engagement rate over the viewer's own observed posts; null until one was seen. */
  readonly ownAverage: { readonly views: number; readonly er: number } | null;
}

/**
 * What the native injections show without a server call: the app already
 * holds the atoms and formats the labels in the account zone.
 */
export interface Glance {
  readonly queued: number;
  /** "Today 21:40" style label of the next queued draft; null with an empty queue. */
  readonly nextScheduled: string | null;
  /** Label of the next posting slot; null without slots. */
  readonly bestTime: string | null;
  readonly mentions: number;
  readonly spendTodayUsd: number;
  readonly connected: boolean;
}

export type OverlayAction =
  | { readonly type: "save"; readonly postId: string }
  | { readonly type: "openRoute"; readonly route: string };
