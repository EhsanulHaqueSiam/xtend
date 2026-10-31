import { isXSkinToggle, X_SKIN_DEFAULTS, type XSkinToggle } from "@xtend/contracts";
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
  executeJavaScript(code: string): Promise<unknown>;
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

/**
 * Loads an x.com URL; other hosts are ignored. Before the guest is ready the last call wins.
 * Resolves once the page has loaded, so an engine step can follow it.
 */
export const xNavigate = (url: string): Promise<void> => {
  if (!isXUrl(url)) return Promise.resolve();
  if (element !== null && ready) return element.loadURL(url).catch(() => {});
  pending = url;
  return Promise.resolve();
};

/** Whether the webview already shows this x.com path, so a screen can skip reloading it. */
export const xShows = (path: string) => {
  try {
    return ready && element !== null && new URL(element.getURL()).pathname === path;
  } catch {
    return false;
  }
};
/**
 * Engine steps for Xtend's own X screens, run in X's page on the user's intent: X's own app does
 * the fetching, and the capture hands its responses to the screens. Nothing here sends anything.
 */
const xRun = (code: string) =>
  ready && element !== null
    ? element.executeJavaScript(code).catch(() => null)
    : Promise.resolve(null);

/** The user scrolled near the end of a native list: X scrolls its own page and fetches the next. */
// X fetches its next page only near the bottom of what it has drawn, so jump there.
export const xScrollMore = () =>
  xRun("window.scrollTo(0, document.documentElement.scrollHeight), true");

/** Picks a tab on X's Home ("For you", "Following") once the page has drawn it. */
export const xPickHomeTab = (label: string) =>
  xRun(`new Promise((done) => {
    let tries = 0;
    const timer = setInterval(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(label)});
      if (tab !== undefined || ++tries > 40) {
        clearInterval(timer);
        if (tab !== undefined && tab.getAttribute("aria-selected") !== "true") tab.click();
        done(tab !== undefined);
      }
    }, 150);
  })`);

/** X's own buttons on a post, by test id, for the user's click on Xtend's copy of it. */
export type XAction = "like" | "retweet" | "bookmark";

/**
 * Presses X's own button for the user's click, on the engine page where the post already sits,
 * so the engine never leaves the list it feeds. False when the post is not on that page.
 */
export const xActInPlace = (postId: string, action: XAction): Promise<boolean> => {
  // The id goes into a script: digits only.
  if (!/^\d{1,25}$/.test(postId)) return Promise.resolve(false);
  return xRun(`(async () => {
    // A page just loaded draws its posts a moment later. The post's own article is the one whose
    // timestamp links to it; a post quoting it links to it too. X's timeline has no bookmark
    // button, so a post that is there without the button fails at once.
    let article = null;
    for (let i = 0; i < 30 && !article; i++) {
      article = document.querySelector('article a[href$="/status/${postId}"] time')?.closest("article") ?? null;
      if (!article) await new Promise((r) => setTimeout(r, 100));
    }
    const button = article?.querySelector('[data-testid="${action}"]');
    if (!button) return false;
    button.click();
    if ("${action}" !== "retweet") return true;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const confirm = document.querySelector('[data-testid="retweetConfirm"]');
      if (confirm) { confirm.click(); return true; }
    }
    return false;
  })()`).then((done) => done === true);
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

/**
 * A route opened from X itself (Reply with AI, Full report) keeps x.com on the post the user was
 * reading instead of moving it to the new section's page.
 * shortcut: a time window, not tied to the one navigation; tie it to the route if a slow load
 * ever lets the panel move anyway.
 */
let holdXPageUntil = 0;
export const holdXPage = () => {
  holdXPageUntil = Date.now() + 1000;
};
export const xPageHeld = () => Date.now() < holdXPageUntil;

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

/** The enabled Clean X toggles, the CSS the desktop puts over x.com. Stored as a comma list. */
export const xSkinAtom = stored<ReadonlyArray<XSkinToggle>>(
  "xtend:x-skin-toggles",
  (raw) => raw.split(",").filter(isXSkinToggle),
  X_SKIN_DEFAULTS,
);
