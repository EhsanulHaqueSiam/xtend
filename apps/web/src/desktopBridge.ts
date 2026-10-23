/**
 * What the Electron preload exposes to the web app. Kept here rather than in
 * contracts because only the desktop shell and this UI ever see it.
 */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where main draws the app over x.com; see apps/desktop/src/window/Slots.ts. */
export type SlotKind = "center" | "popover" | "sheet" | "palette" | "bar" | "toast";

interface SlotOpen {
  readonly kind: SlotKind;
  readonly route: string;
  /** Trigger rect in x.com CSS pixels; popovers hang off it. */
  readonly anchor?: Rect;
}

/** Null kind: the view is hidden; the route is the last one shown. */
export interface SlotState {
  readonly kind: SlotKind | null;
  readonly route: string;
}

/** Keys main handled on the app's behalf: ⌘K, C, P, A, E, L, ⌘F, ⌘L, ⌥O. */
type ShortcutKey =
  | "palette"
  | "compose"
  | "plan"
  | "analyze"
  | "engage"
  | "library"
  | "find"
  | "address"
  | "overlayToggle";

export interface SessionFindResult {
  readonly activeMatchOrdinal: number;
  readonly matches: number;
}

interface SessionDownload {
  readonly name: string;
  readonly state: "started" | "completed" | "failed";
}

/** What the x.com injections (Today card, composer chip) show; the app computes and formats it. */
export interface Glance {
  readonly queued: number;
  readonly nextScheduled: string | null;
  readonly bestTime: string | null;
  readonly mentions: number;
  readonly spendTodayUsd: number;
  readonly connected: boolean;
}

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
  /** The account whose session partition the window opened. */
  readonly accountId: number;
  /** The slot at page load; `onSlot` carries every change after. */
  readonly slot: SlotState;
  readonly checkRemote: (config: RemoteConfig) => Promise<Reachability>;
  /** Saves the remote (null returns to the local service) and relaunches the app. */
  readonly setRemote: (config: RemoteConfig | null) => void;
  /** Rebuilds the window on the account's own session partition. */
  readonly selectAccount: (id: number) => void;
  /** Asks main to show the view in a slot on a route; main answers through `onSlot`. */
  readonly openSlot: (slot: SlotOpen) => void;
  /** Hides the view. With a kind, only when that kind is the open one. */
  readonly closeSlot: (close?: { readonly kind?: SlotKind }) => void;
  /** Hands main the summary the x.com injections draw; main forwards it to the overlay preload. */
  readonly pushGlance: (glance: Glance) => void;
  /** Loads an x.com URL in the window; other hosts are ignored. */
  readonly navigateSession: (url: string) => void;
  /** Drives find-in-page on x.com; null stops it and clears highlights. */
  readonly sessionFind: (
    find: { readonly text: string; readonly forward: boolean; readonly findNext: boolean } | null,
  ) => void;
  readonly openExternal: (url: string) => void;
  readonly onSlot: (cb: (slot: SlotState) => void) => () => void;
  readonly onSessionUrl: (cb: (url: string) => void) => () => void;
  readonly onSessionFindResult: (cb: (result: SessionFindResult) => void) => () => void;
  readonly onSessionDownload: (cb: (download: SessionDownload) => void) => () => void;
  readonly onShortcut: (cb: (key: ShortcutKey) => void) => () => void;
}
