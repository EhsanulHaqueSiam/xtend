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
/** The page asked for before the guest could load it, and who waits for it to load. */
let pending: { url: string; waiters: Array<() => void> } | null = null;

/** Called by XPane: the element exists, and later, its guest can take commands. */
export const registerXWebview = (el: XWebview | null) => {
  element = el;
  ready = false;
};
export const markXReady = () => {
  ready = true;
  const asked = pending;
  pending = null;
  if (asked === null || element === null) return;
  const done = () => asked.waiters.forEach((resolve) => resolve());
  // The guest's first page is often the one asked for; loading it again costs X a second boot.
  if (element.getURL() === asked.url) done();
  else
    void element
      .loadURL(asked.url)
      .catch(() => {})
      .then(done);
};

/**
 * Loads an x.com URL; other hosts are ignored. Resolves once the page has loaded, so an engine
 * step (picking Home's tab) can follow it. Before the guest is ready the last call wins and every
 * caller waits for that load: resolving early would run the step against no page at all.
 */
export const xNavigate = (url: string): Promise<void> => {
  if (!isXUrl(url)) return Promise.resolve();
  if (element !== null && ready) return element.loadURL(url).catch(() => {});
  return new Promise((resolve) => {
    pending = { url, waiters: [...(pending?.waiters ?? []), resolve] };
  });
};

/**
 * Moves the engine to an x.com page through X's own router, as a link clicked in X would: about a
 * second instead of a full reload, and a page X still holds shows without a fetch, so a screen
 * reads that page's keyed surface rather than resetting one. Before the first load, or when the
 * webview is not on a signed-in x.com page, it loads the URL instead.
 */
export const xGo = (url: string): Promise<void> => {
  if (!isXUrl(url)) return Promise.resolve();
  if (element === null || !ready) return xNavigate(url);
  const el = element;
  let here: URL;
  try {
    here = new URL(el.getURL());
  } catch {
    return xNavigate(url);
  }
  if (!X_HOSTS.has(here.hostname) || here.pathname.startsWith("/i/flow/")) return xNavigate(url);
  const target = new URL(url);
  const path = target.pathname + target.search;
  if (here.pathname + here.search === path) return Promise.resolve();
  return el
    .executeJavaScript(
      `history.pushState(null, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate", { state: null })); true`,
    )
    .then(
      () => {},
      () => xNavigate(url),
    );
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

/**
 * The user scrolled near the end of a native list: X scrolls its own page and fetches the next.
 * X fetches when its end marker comes into view, and some jumps to the bottom fetch nothing (the
 * marker was in view already, or X was mid-fetch), so keep following the bottom until the last
 * post X draws there changes, stepping back a screen between tries so the marker comes into view
 * anew. A native list asks once per length, so one ask has to land. Page height is no signal:
 * images loading grow it too.
 */
export const xScrollMore = () =>
  xRun(`(async () => {
    const last = () => [...document.querySelectorAll('article a[href*="/status/"] time')].at(-1)?.closest("a")?.getAttribute("href");
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    const before = last();
    for (let attempt = 0; attempt < 4; attempt++) {
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 250));
        window.scrollTo(0, document.documentElement.scrollHeight);
        if (last() !== before) return true;
      }
      window.scrollBy(0, -window.innerHeight);
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })()`);

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

/**
 * X's own buttons on a post, by test id, for the user's click on Xtend's copy of it: what each
 * turns into once pressed, and the confirm X asks for first.
 */
const BUTTONS = {
  like: { turns: "unlike" },
  unlike: { turns: "like" },
  retweet: { turns: "unretweet", confirm: "retweetConfirm" },
  unretweet: { turns: "retweet", confirm: "unretweetConfirm" },
  bookmark: { turns: "removeBookmark" },
  removeBookmark: { turns: "bookmark" },
} as const satisfies Record<string, { readonly turns: string; readonly confirm?: string }>;
export type XAction = keyof typeof BUTTONS;

/**
 * A script for X's page: presses the button `testid` inside `scope` (an expression evaluating to
 * an element or null), presses X's confirm when it asks, then waits for the button to turn into
 * `turns`. X turns it at once and saves a moment later; leaving the page before then would cancel
 * the save, so it also gives the request time to go out. Resolves to whether it pressed.
 */
const pressScript = (scope: string, testid: string, turns: string, confirm: string | undefined) => `
    const scope = ${scope};
    const button = scope?.querySelector('[data-testid="${testid}"]');
    if (!button) return false;
    button.click();
    if (${JSON.stringify(confirm ?? null)} !== null) {
      let confirm = null;
      for (let i = 0; i < 20 && !confirm; i++) {
        await new Promise((r) => setTimeout(r, 100));
        confirm = document.querySelector('[data-testid="${confirm}"]');
      }
      if (!confirm) return false;
      confirm.click();
    }
    for (let i = 0; i < 30 && !scope.querySelector('[data-testid="${turns}"]'); i++)
      await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1000));
    return true;`;

/**
 * Presses X's own button for the user's click, on the engine page where the post already sits,
 * so the engine never leaves the list it feeds. False when the post is not on that page.
 */
export const xActInPlace = (postId: string, action: XAction): Promise<boolean> => {
  // The id goes into a script: digits only.
  if (!/^\d{1,25}$/.test(postId)) return Promise.resolve(false);
  const { turns, confirm }: { readonly turns: string; readonly confirm?: string } = BUTTONS[action];
  return xRun(`(async () => {
    // A page just loaded draws its posts a moment later, so wait for X's first post, then look
    // for this one briefly. The post's own article is the one whose timestamp links to it (to its
    // edit history, once edited); a post quoting it links to it too.
    for (let i = 0; i < 100 && !document.querySelector("article"); i++)
      await new Promise((r) => setTimeout(r, 100));
    let article = null;
    for (let i = 0; i < 10 && !article; i++) {
      article = document.querySelector('article a[href$="/status/${postId}"] time, article a[href$="/status/${postId}/history"] time')?.closest("article") ?? null;
      if (!article) await new Promise((r) => setTimeout(r, 100));
    }
    ${pressScript("article", action, turns, confirm)}
  })()`).then((done) => done === true);
};

/**
 * Follows or unfollows for the user's click through X's own button: in place when the engine page
 * shows one for this person (a profile, a people list), otherwise on their profile, reached
 * through X's router and left with Back. X asks to confirm an unfollow. True when X took it.
 */
export const xFollow = async (
  user: { readonly userId: string; readonly handle: string },
  follow: boolean,
): Promise<boolean> => {
  // Both go into scripts run in X's page: digits and a handle only.
  if (!/^\d{1,25}$/.test(user.userId) || !/^[A-Za-z0-9_]{1,15}$/.test(user.handle)) return false;
  const [press, turns] = follow ? ["follow", "unfollow"] : ["unfollow", "follow"];
  // This person's own button, waited for up to `tries` tenths of a second: briefly where the
  // engine already is, longer on a profile X is still drawing (another person's button, a
  // recommendation, may be drawn first).
  const script = (tries: number) => `(async () => {
    const mine = '[data-testid="${user.userId}-follow"], [data-testid="${user.userId}-unfollow"]';
    for (let i = 0; i < ${tries} && !document.querySelector(mine); i++)
      await new Promise((r) => setTimeout(r, 100));
    ${pressScript(
      `document.querySelector('[data-testid="${user.userId}-${press}"]')?.parentElement ?? null`,
      `${user.userId}-${press}`,
      `${user.userId}-${turns}`,
      follow ? undefined : "confirmationSheetConfirm",
    )}
  })()`;
  if ((await xRun(script(10))) === true) return true;
  await xGo(`https://x.com/${user.handle}`);
  const done = (await xRun(script(100))) === true;
  await xRun(
    `location.pathname.toLowerCase() === ${JSON.stringify(`/${user.handle.toLowerCase()}`)} && history.back(), true`,
  );
  return done;
};

/**
 * X's own button for the user's click on Xtend's copy of a post: in place where the engine page
 * holds it, otherwise on the post's own page, reached through X's router and left with Back, so X
 * restores the list it was on, scroll included. True when X took the click.
 */
export const xAct = async (
  post: { readonly postId: string; readonly handle: string },
  action: XAction,
): Promise<boolean> => {
  // Both go into scripts run in X's page: digits and a handle only.
  if (!/^\d{1,25}$/.test(post.postId) || !/^[A-Za-z0-9_]{1,15}$/.test(post.handle)) return false;
  if (await xActInPlace(post.postId, action)) return true;
  await xGo(`https://x.com/${post.handle}/status/${post.postId}`);
  const done = await xActInPlace(post.postId, action);
  // Only while the engine is still on the post: the user may have moved it on meanwhile.
  await xRun(
    `location.pathname.endsWith(${JSON.stringify(`/status/${post.postId}`)}) && history.back(), true`,
  );
  return done;
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
