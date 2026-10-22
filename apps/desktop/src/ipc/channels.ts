/** IPC between the main process, the app window's preload and the session view's overlay preload. */

// App window -> main
export const SESSION_VIEW_BOUNDS_CHANNEL = "xtend:session-view-bounds";
export const SESSION_VIEW_HIDDEN_CHANNEL = "xtend:session-view-hidden";
export const SESSION_NAVIGATE_CHANNEL = "xtend:session-navigate";
export const SESSION_FIND_CHANNEL = "xtend:session-find";
export const OPEN_EXTERNAL_CHANNEL = "xtend:open-external";

// Main -> app window
export const SESSION_URL_CHANNEL = "xtend:session-url";
export const SESSION_FIND_RESULT_CHANNEL = "xtend:session-find-result";
export const SESSION_DOWNLOAD_CHANNEL = "xtend:session-download";
export const SHORTCUT_CHANNEL = "xtend:shortcut";
export const OPEN_ROUTE_CHANNEL = "xtend:open-route";

// Either preload -> main: whether a text field has focus, so single-letter shortcuts stay typing.
export const EDITING_CHANNEL = "xtend:editing";

// Main -> overlay preload
export const OVERLAY_DATA_CHANNEL = "xtend:overlay-data";
export const OVERLAY_TOGGLE_CHANNEL = "xtend:overlay-toggle";
export const OVERLAY_HIDE_CHANNEL = "xtend:overlay-hide";
// Overlay preload -> main
export const OVERLAY_ACTION_CHANNEL = "xtend:overlay-action";

export type SessionNavigation =
  | { readonly action: "url"; readonly url: string }
  | { readonly action: "back" | "forward" | "reload" };

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

export type ShortcutKey =
  | "palette"
  | "compose"
  | "plan"
  | "analyze"
  | "engage"
  | "library"
  | "find"
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
  | { readonly type: "openRoute"; readonly href: string };
