import * as Atom from "effect/reactivity/Atom";

/**
 * The x.com webview: one element for the life of the window, so the user's
 * session, scroll and media never reload when Xtend moves it between the main
 * area and the side panel. Screens drive it through these functions; the
 * atoms mirror what it shows.
 */

/** The `<webview>` methods Xtend uses: Electron's WebviewTag, narrowed. */
export interface XWebview extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
}

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
const isXUrl = (url: string) => {
  try {
    return X_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

let element: XWebview | null = null;
let ready = false;
let pending: string | null = null;

/** Called by XPane: the element exists, and later, its guest can take commands. */
export const registerXWebview = (el: XWebview | null) => {
  element = el;
  ready = false;
};
export const markXReady = () => {
  ready = true;
  if (pending !== null) void element?.loadURL(pending).catch(() => {});
  pending = null;
};

/** Loads an x.com URL; other hosts are ignored. Before the guest is ready the last call wins. */
export const xNavigate = (url: string) => {
  if (!isXUrl(url)) return;
  if (element !== null && ready) void element.loadURL(url).catch(() => {});
  else pending = url;
};
export const xBack = () => (ready ? element?.goBack() : undefined);
export const xForward = () => (ready ? element?.goForward() : undefined);
export const xReload = () => (ready ? element?.reload() : undefined);
/** Find in page; null stops and clears the highlights. Results arrive as `found-in-page`. */
export const xFind = (
  find: { readonly text: string; readonly forward: boolean; readonly findNext: boolean } | null,
) => {
  if (!ready || element === null) return;
  if (find === null || find.text === "") element.stopFindInPage("clearSelection");
  else element.findInPage(find.text, { forward: find.forward, findNext: find.findNext });
};

/** The routes where x.com fills the main area; everywhere else it is the side panel. */
export const isXRoute = (pathname: string) => pathname === "/x" || pathname === "/";

/** The last tool route the user was on, so ⌘\ from X's own pages can return beside it. */
let lastToolHref = "/compose";
export const rememberToolRoute = (href: string) => {
  lastToolHref = href;
};
export const lastToolRoute = () => lastToolHref;

/** The URL x.com shows now; XPane sets it on every navigation. */
export const xUrlAtom = Atom.make("");

/** X's unread count, read from the "(3) Home / X" page title: free and passive. */
export const xUnreadAtom = Atom.make(0);

/** Whether the find bar over x.com is open. */
export const xFindOpenAtom = Atom.make(false);

export const stored = <A>(key: string, decode: (raw: string) => A | undefined, fallback: A) =>
  Atom.keepAlive(
    Atom.writable(
      () => {
        try {
          const raw = window.localStorage.getItem(key);
          return (raw === null ? undefined : decode(raw)) ?? fallback;
        } catch {
          return fallback;
        }
      },
      (ctx, value: A) => {
        try {
          window.localStorage.setItem(key, String(value));
        } catch {}
        ctx.setSelf(value);
      },
    ),
  );

/** Whether x.com sits beside the tool screens (⌘\). Kept across launches. */
export const xPanelOpenAtom = stored("xtend:x-panel-open", (raw) => raw === "true", true);

const X_PANEL_MIN = 360;
const X_PANEL_MAX = 760;
const clampWidth = (n: number) => Math.min(X_PANEL_MAX, Math.max(X_PANEL_MIN, Math.round(n)));

/** The side panel's width in CSS pixels, dragged from its left edge. */
export const xPanelWidthAtom = stored(
  "xtend:x-panel-width",
  (raw) => (Number.isFinite(Number(raw)) ? clampWidth(Number(raw)) : undefined),
  440,
);
export const clampXPanelWidth = clampWidth;

/**
 * Pinned: the sidebar's X rows load into the panel beside the open tool instead of taking
 * the main area, so a tool and X stay side by side.
 */
export const xPanelPinnedAtom = stored("xtend:x-panel-pinned", (raw) => raw === "true", false);

/** Whether the X skin (CSS that hides X's own nav and right column) is on. */
export const xSkinAtom = stored("xtend:x-skin", (raw) => raw !== "false", true);
