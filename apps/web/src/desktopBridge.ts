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

export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  /** Where the x.com session view should be drawn, in CSS pixels of the app window. Null hides it. */
  readonly setSessionViewBounds: (bounds: SessionViewBounds | null) => void;
}
