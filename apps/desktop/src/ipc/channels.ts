/** IPC between the main process, the xtend view's app preload and the x.com window's overlay preload. */

// App view -> main
export const SESSION_NAVIGATE_CHANNEL = "xtend:session-navigate";
export const SESSION_FIND_CHANNEL = "xtend:session-find";
export const OPEN_EXTERNAL_CHANNEL = "xtend:open-external";
export const ACCOUNT_SELECT_CHANNEL = "xtend:account-select";
export const REMOTE_SET_CHANNEL = "xtend:remote-set";
/** invoke: checks a remote service's health and token from the main process (no CORS, no leaked token). */
export const REMOTE_CHECK_CHANNEL = "xtend:remote-check";
/** sendSync from the app preload: bridge info (incl. the service token) must not ride in argv, which `ps` shows. */
export const BRIDGE_INFO_CHANNEL = "xtend:bridge-info";
export const SLOT_OPEN_CHANNEL = "xtend:slot-open";
export const SLOT_CLOSE_CHANNEL = "xtend:slot-close";

// Main -> app view
export const SESSION_URL_CHANNEL = "xtend:session-url";
export const SESSION_FIND_RESULT_CHANNEL = "xtend:session-find-result";
export const SESSION_DOWNLOAD_CHANNEL = "xtend:session-download";
export const SHORTCUT_CHANNEL = "xtend:shortcut";
export const SLOT_CHANNEL = "xtend:slot";

// Either preload -> main: whether a text field has focus, so single-letter shortcuts stay typing.
export const EDITING_CHANNEL = "xtend:editing";

// Main -> overlay preload
export const OVERLAY_DATA_CHANNEL = "xtend:overlay-data";
export const OVERLAY_TOGGLE_CHANNEL = "xtend:overlay-toggle";
export const OVERLAY_HIDE_CHANNEL = "xtend:overlay-hide";
// Overlay preload -> main
export const OVERLAY_ACTION_CHANNEL = "xtend:overlay-action";
/** X's primary column rect in x.com CSS pixels, null while the page has none (DMs, settings). */
export const COLUMN_RECT_CHANNEL = "xtend:column-rect";
/** Any pointerdown in x.com; main closes the open slot on it. */
export const POINTER_DOWN_CHANNEL = "xtend:pointer-down";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the xtend view is drawn over x.com; see window/Slots.ts for the geometry. */
export type SlotKind = "center" | "popover" | "sheet" | "palette" | "bar" | "toast";

export interface SlotOpen {
  readonly kind: SlotKind;
  readonly route: string;
  /** Trigger rect in x.com CSS pixels; popovers hang off it. */
  readonly anchor?: Rect | undefined;
}

export interface SlotClose {
  /** Only closes when this kind is the open one; omitted closes whatever is open. */
  readonly kind?: SlotKind | undefined;
}

/** What main tells the app view: null kind means hidden, the route is the one it should show. */
export interface SlotState {
  readonly kind: SlotKind | null;
  readonly route: string;
}

/** Null stops the search and clears the highlights. */
export type SessionFind = {
  readonly text: string;
  readonly forward: boolean;
  readonly findNext: boolean;
} | null;

export interface SessionFindResult {
  readonly activeMatchOrdinal: number;
  readonly matches: number;
}

export interface SessionDownload {
  readonly name: string;
  readonly state: "started" | "completed" | "failed";
}

/** What the main process tells the app view about its service at load time. */
export interface BridgeInfo {
  readonly serviceToken: string;
  readonly serviceMode: "child" | "launchd" | "remote" | "none";
  readonly remote: { readonly url: string; readonly token: string } | null;
  readonly accountId: number;
  readonly slot: SlotState;
}

export type ShortcutKey =
  | "palette"
  | "compose"
  | "plan"
  | "analyze"
  | "engage"
  | "library"
  | "find"
  | "address"
  | "overlayToggle";

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

export type OverlayAction =
  | { readonly type: "save"; readonly postId: string }
  | { readonly type: "openSlot"; readonly slot: SlotOpen };
