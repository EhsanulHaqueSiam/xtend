/**
 * What the Electron preload exposes to the web app. Kept here rather than in
 * contracts because only the desktop shell and this UI ever see it.
 */
interface SessionViewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Keys forwarded from whichever view had focus: ⌘K, C, P, A, E, L, ⌘F, ⌥O. */
export type ShortcutKey =
  | "palette"
  | "compose"
  | "plan"
  | "analyze"
  | "engage"
  | "library"
  | "find"
  | "overlayToggle";

export interface SessionFindResult {
  readonly activeMatchOrdinal: number;
  readonly matches: number;
}

export interface SessionDownload {
  readonly name: string;
  readonly state: "started" | "completed" | "failed";
}

export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  /** Where the x.com session view should be drawn, in CSS pixels of the app window. Null hides it. */
  readonly setSessionViewBounds: (bounds: SessionViewBounds | null) => void;
  /** Hides the native view without unloading it, for while a palette or modal draws over its area. */
  readonly setSessionViewHidden: (hidden: boolean) => void;
  /** Loads an x.com URL in the session view; other hosts are ignored. */
  readonly navigateSession: (url: string) => void;
  readonly sessionBack: () => void;
  readonly sessionForward: () => void;
  readonly sessionReload: () => void;
  /** Drives find-in-page on the session view; null stops it and clears highlights. */
  readonly sessionFind: (
    find: { readonly text: string; readonly forward: boolean; readonly findNext: boolean } | null,
  ) => void;
  readonly openExternal: (url: string) => void;
  readonly onSessionUrl: (cb: (url: string) => void) => () => void;
  readonly onSessionFindResult: (cb: (result: SessionFindResult) => void) => () => void;
  readonly onSessionDownload: (cb: (download: SessionDownload) => void) => () => void;
  readonly onShortcut: (cb: (key: ShortcutKey) => void) => () => void;
  /** The overlay asked for an app route, e.g. "/compose?reply=123". */
  readonly onOpenRoute: (cb: (href: string) => void) => () => void;
}
