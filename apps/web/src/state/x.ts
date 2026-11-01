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
 * Moves the engine to an x.com page through X's own router, like a link clicked in X: no full
 * reload, and a page X still holds shows without a fetch, so screens read its keyed surface. Loads
 * the URL instead before the first load or off a signed-in x.com page. True when it moved.
 */
export const xGo = (url: string): Promise<boolean> => {
  if (!isXUrl(url)) return Promise.resolve(false);
  const load = () => xNavigate(url).then(() => true);
  if (element === null || !ready) return load();
  const el = element;
  let here: URL;
  try {
    here = new URL(el.getURL());
  } catch {
    return load();
  }
  if (!X_HOSTS.has(here.hostname) || here.pathname.startsWith("/i/flow/")) return load();
  const target = new URL(url);
  const path = target.pathname + target.search;
  if (here.pathname + here.search === path) return Promise.resolve(false);
  return el
    .executeJavaScript(
      `history.pushState(null, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate", { state: null })); true`,
    )
    .then(() => true, load);
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
 * Near a native list's end, X scrolls its own page to fetch the next. A jump to the bottom can
 * fetch nothing (end marker already in view, or X mid-fetch), and the list asks once per length,
 * so it follows the bottom, a screen back between tries, until X's last post or person changes.
 * Page height is no signal: images grow it too.
 */
export const xScrollMore = () =>
  xRun(`(async () => {
    // A people list (reposters, search People) has no posts: without its rows this never sees X's
    // next page land and keeps scrolling, so X fetches page after page.
    const last = () => [...document.querySelectorAll('article a[href*="/status/"] time, [data-testid="UserCell"] a[href^="/"]')].at(-1)?.closest("a")?.getAttribute("href");
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
    ${findArticle(postId)}
    ${pressScript("article", action, turns, confirm)}
  })()`).then((done) => done === true);
};

/**
 * A script step that sets `article` to X's own article for the post on the engine page, or null.
 * A page just loaded draws its posts a moment later, so it waits for X's first post, then looks
 * for this one briefly. The post's own article is the one whose timestamp links to it (to its
 * edit history, once edited); a post quoting it links to it too. `postId` must be digits.
 */
const findArticle = (postId: string) => `
    for (let i = 0; i < 100 && !document.querySelector("article"); i++)
      await new Promise((r) => setTimeout(r, 100));
    let article = null;
    for (let i = 0; i < 10 && !article; i++) {
      article = document.querySelector('article a[href$="/status/${postId}"] time, article a[href$="/status/${postId}/history"] time')?.closest("article") ?? null;
      if (!article) await new Promise((r) => setTimeout(r, 100));
    }`;

/** X's buttons on a post that open a menu: its "..." and its share button (X gives it no test id). */
const MENUS = {
  more: '[data-testid="caret"]',
  share: '[role="group"] button[aria-label="Share post"]',
} as const;
export type XPostMenu = keyof typeof MENUS;

/**
 * Where one of X's menus sits on the engine page: `find` is a script step that sets the variable
 * `root` names to the element holding it (or null), `trigger` selects X's button inside it.
 */
interface MenuAt {
  readonly find: string;
  readonly root: string;
  readonly trigger: string;
}
const postMenuAt = (postId: string, menu: XPostMenu): MenuAt => ({
  find: findArticle(postId),
  root: "article",
  trigger: MENUS[menu],
});

/**
 * X's "..." in a profile's header, once X has drawn it. Only on that person's own page: X draws
 * none on the user's own profile. `handle` must be a handle.
 */
const profileMenuAt = (handle: string): MenuAt => ({
  find: `
    let profile = null;
    if (location.pathname.split("/")[1]?.toLowerCase() === ${JSON.stringify(handle.toLowerCase())})
      for (let i = 0; i < 50 && !profile; i++) {
        profile = document.querySelector('[data-testid="userActions"]') ? document : null;
        if (!profile) await new Promise((r) => setTimeout(r, 100));
      }`,
  root: "profile",
  trigger: '[data-testid="userActions"]',
});

/**
 * A script step that opens X's menu `at` and sets `items` to its rows once drawn; the step after
 * it closes the menu (`closeMenu`) or presses a row.
 */
const openMenu = (at: MenuAt) => `
    ${at.find}
    const trigger = ${at.root}?.querySelector(${JSON.stringify(at.trigger)});
    if (!trigger) return null;
    trigger.click();
    let items = [];
    for (let i = 0; i < 20 && items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      items = [...document.querySelectorAll('[data-testid="Dropdown"] [role="menuitem"]')];
    }
    // X closes its menu on a click outside it, on the mask drawn beside it; Escape from a script does not.
    const closeMenu = () => {
      const menu = document.querySelector('[role="menu"]');
      [...(menu?.parentElement?.children ?? [])].find((k) => k !== menu && k.getBoundingClientRect().height > 0)?.click();
    };`;

/** What X did when the user pressed one of its menu items. */
export type XMenuOutcome =
  /** X acted at once; `toast` is what X said, `undo` whether X offered to take it back. */
  | { readonly kind: "done"; readonly toast: string | null; readonly undo: boolean }
  /** X opened its own dialog or page (Report, Block, Delete, Send via Chat) at `path`'s page. */
  | { readonly kind: "over"; readonly path: string };

/** X's menu `at`, read on the engine page: its rows' labels, in X's order. */
const xMenuInPlace = (at: MenuAt) =>
  xRun(`(async () => {
    ${openMenu(at)}
    const labels = items.map((i) => i.textContent.trim());
    closeMenu();
    return labels;
  })()`).then((labels) =>
    Array.isArray(labels) && labels.every((l) => typeof l === "string")
      ? (labels as ReadonlyArray<string>)
      : null,
  );

/** Presses row `label` of X's menu `at` on the engine page. Null when it is not there. */
const xMenuPressInPlace = (at: MenuAt, label: string) =>
  xRun(`(async () => {
    ${openMenu(at)}
    const item = items.find((i) => i.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return (closeMenu(), null);
    const path = location.pathname + location.search;
    item.click();
    await new Promise((r) => setTimeout(r, 800));
    // A confirm sheet (Block, Mute this conversation, Delete) or a page (Report, post activity).
    if (location.pathname + location.search !== path || document.querySelector('[role="dialog"], [role="alertdialog"]'))
      return { kind: "over", path };
    const toast = document.querySelector('[data-testid="toast"]');
    const actions = [...(toast?.querySelectorAll('button, a, [role="button"]') ?? [])];
    const text = actions.reduce((t, a) => t.replace(a.textContent, ""), toast?.textContent ?? "").trim();
    return { kind: "done", toast: text || null, undo: actions.some((a) => a.textContent.trim() === "Undo") };
  })()`).then((outcome) => (outcome === null ? null : (outcome as XMenuOutcome)));

/**
 * Runs `step` where X shows what it acts on: in place on the engine page, or on `page` (its own
 * x.com page, and how that page's path ends) reached through X's router. `leave` runs on the step's result before
 * the engine goes Back from a page this opened, so X restores the list it was on. Null when X
 * showed it on neither.
 */
const onPage = async <A>(
  page: { readonly url: string; readonly path: string },
  step: () => Promise<A | null>,
  leave: (result: A) => Promise<unknown> = () => Promise.resolve(),
  live: () => boolean = () => true,
): Promise<A | null> => {
  // No engine (a browser): no X.
  if (element === null || !ready) return null;
  const here = await step();
  if (here !== null) return (await leave(here), here);
  // The user moved on meanwhile: the engine is theirs, not this press's.
  if (!live()) return null;
  const moved = await xGo(page.url);
  const there = live() ? await step() : null;
  if (there !== null) await leave(there);
  // Back only from a page this step opened, while the engine is still on it, and while this
  // press is still the user's latest: a screen they opened since owns the engine now.
  if (moved && live())
    await xRun(
      `location.pathname.toLowerCase().endsWith(${JSON.stringify(page.path.toLowerCase())}) && history.back(), true`,
    );
  return there;
};

type PostRef = { readonly postId: string; readonly handle: string };
// Both go into scripts run in X's page: digits and a handle only.
const validPost = (post: PostRef) =>
  /^\d{1,25}$/.test(post.postId) && /^[A-Za-z0-9_]{1,15}$/.test(post.handle);
const validHandle = (handle: string) => /^[A-Za-z0-9_]{1,15}$/.test(handle);
const postPage = (post: PostRef) => ({
  url: `https://x.com/${post.handle}/status/${post.postId}`,
  // X may show it under the author's new handle.
  path: `/status/${post.postId}`,
});
const profilePage = (handle: string) => ({ url: `https://x.com/${handle}`, path: `/${handle}` });

/** X's own rows of a post's `menu`, read from X's menu for the user's click on Xtend's copy. */
export const xPostMenu = async (post: PostRef, menu: XPostMenu = "more") =>
  validPost(post)
    ? onPage(postPage(post), () => xMenuInPlace(postMenuAt(post.postId, menu)))
    : null;

/** X's own rows of a profile's "...", read from X's menu for the user's click on Xtend's. */
export const xProfileMenu = async (handle: string) =>
  validHandle(handle)
    ? onPage(profilePage(handle), () => xMenuInPlace(profileMenuAt(handle)))
    : null;

/** True while X's own dialog or page from a menu row is up: the engine shows over the main area. */
export const xOverAtom = Atom.make(false);

let overRun = 0;
/** The user moved to another screen: whatever X's dialog was, the engine is no longer over it. */
export const xOverEnded = () => void overRun++;

/**
 * Presses row `label` of X's menu `at` on `page` for the user's click. When X answers with its own
 * dialog or page, `over` puts the engine over the main area until X is back where it was with no
 * dialog (the user finished or closed it), or the user moved to another screen.
 */
const pressMenu = (
  page: { readonly url: string; readonly path: string },
  at: MenuAt,
  label: string,
  over: (shown: boolean) => void,
) => {
  // Taken before X answers: a screen change meanwhile means the dialog no longer belongs here.
  const run = ++overRun;
  return onPage(
    page,
    () => xMenuPressInPlace(at, label),
    (outcome) => (outcome.kind === "over" ? holdOver(run, outcome.path, over) : Promise.resolve()),
    () => run === overRun,
  );
};

/**
 * Shows the engine over the main area while X's own dialog or page, opened by a press at `path`,
 * is up: until X is back on `path` with no dialog, or press `run` is no longer the latest.
 */
const holdOver = async (run: number, path: string, over: (shown: boolean) => void) => {
  if (run !== overRun) return;
  over(true);
  for (;;) {
    await new Promise((r) => setTimeout(r, 500));
    if (run !== overRun) return;
    const open = await xRun(
      `location.pathname + location.search !== ${JSON.stringify(path)} || !!document.querySelector('[role="dialog"], [role="alertdialog"]')`,
    );
    if (open !== true) break;
  }
  over(false);
};

/**
 * Presses X's own Subscribe for a creator for the user's click: in place where the engine page
 * draws it (X's Follow page lists creators with it, but only the rows near its scroll), otherwise
 * on their profile. X answers with its own subscribe dialog, shown over the main area (see
 * `holdOver`); paying happens there, in X. False when X showed no dialog.
 */
export const xSubscribe = async (
  user: { readonly userId: string; readonly handle: string },
  over: (shown: boolean) => void,
) => {
  // Both go into scripts run in X's page: digits and a handle only.
  if (!/^\d{1,25}$/.test(user.userId) || !validHandle(user.handle)) return false;
  const run = ++overRun;
  // A list row has the test id; a profile's header labels it "Subscribe to @handle" (any case).
  // Briefly where the engine is, longer on a profile X is still drawing.
  let tries = 10;
  const press = () =>
    xRun(`(async () => {
    const label = ${JSON.stringify(`subscribe to @${user.handle.toLowerCase()}`)};
    const find = () => document.querySelector('[data-testid="${user.userId}-subscribe"]') ??
      [...document.querySelectorAll("button[aria-label]")].find((b) => b.getAttribute("aria-label").toLowerCase() === label);
    for (let i = 0; i < ${tries} && !find(); i++) await new Promise((r) => setTimeout(r, 100));
    const button = find();
    if (!button) return null;
    const path = location.pathname + location.search;
    button.click();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (location.pathname + location.search !== path || document.querySelector('[role="dialog"]')) return path;
    }
    return null;
  })()`).then((path) => {
      tries = 50;
      return typeof path === "string" ? path : null;
    });
  const live = () => run === overRun;
  return (
    (await onPage(profilePage(user.handle), press, (path) => holdOver(run, path, over), live)) !==
    null
  );
};

/** Presses X's own row `label` of a post's `menu` for the user's click (see `pressMenu`). */
export const xPostMenuPress = async (
  post: PostRef,
  label: string,
  over: (shown: boolean) => void,
  menu: XPostMenu = "more",
) =>
  validPost(post) ? pressMenu(postPage(post), postMenuAt(post.postId, menu), label, over) : null;

/** Presses X's own row `label` of a profile's "..." for the user's click (see `pressMenu`). */
export const xProfileMenuPress = async (
  handle: string,
  label: string,
  over: (shown: boolean) => void,
) =>
  validHandle(handle) ? pressMenu(profilePage(handle), profileMenuAt(handle), label, over) : null;

/** X's post-notification bell in a profile's header (no test id); its label says what a press does. */
const BELL =
  'button[aria-label="Turn on post notifications"], button[aria-label="Turn off post notifications"]';

/**
 * A script step for `handle`'s profile on X's page: `here()` holds while X shows that profile's
 * header (its path and its @handle; X can move on mid-script), `bell()` is X's bell there. It waits
 * for the header, then briefly for the bell, which X draws only for someone the user follows.
 * `handle` must be a handle.
 */
const profileBell = (handle: string) => `
    const want = ${JSON.stringify(handle.toLowerCase())};
    const here = () =>
      location.pathname.split("/")[1]?.toLowerCase() === want &&
      [...document.querySelectorAll('[data-testid="UserName"] span')].some((s) => s.textContent.trim().toLowerCase() === "@" + want);
    const bell = () => (here() ? document.querySelector(${JSON.stringify(BELL)}) : null);
    for (let i = 0; i < 50 && !here(); i++) await new Promise((r) => setTimeout(r, 100));
    for (let i = 0; i < 15 && here() && !bell(); i++) await new Promise((r) => setTimeout(r, 100));`;

/**
 * X's bell on `handle`'s profile where the engine shows it: true or false for on or off, null when
 * X draws none there, "away" when the engine is not (or no longer) on that profile.
 */
export const xBell = (handle: string): Promise<boolean | null | "away"> =>
  validHandle(handle)
    ? xRun(`(async () => {
    ${profileBell(handle)}
    if (!here()) return "away";
    return bell() ? bell().getAttribute("aria-label").startsWith("Turn off") : "none";
  })()`).then((on) =>
        // A read cut short (a reload, no engine) answers null: that is "away", never "no bell".
        typeof on === "boolean" ? on : on === "none" ? null : "away",
      )
    : Promise.resolve("away");

/**
 * Turns post notifications for `handle` on or off for the user's click, pressing X's own bell on
 * their profile. It presses only while X still shows that profile. True once X's bell says so.
 */
export const xBellPress = async (handle: string, on: boolean) =>
  validHandle(handle) &&
  (await onPage(profilePage(handle), () =>
    xRun(`(async () => {
    ${profileBell(handle)}
    if (!bell()) return null;
    const took = () => bell()?.getAttribute("aria-label").startsWith("Turn off") === ${on};
    if (took()) return true;
    bell().click();
    for (let i = 0; i < 30 && !took(); i++) await new Promise((r) => setTimeout(r, 100));
    // X flips the bell at once and saves a moment later; leaving before then would cancel it.
    await new Promise((r) => setTimeout(r, 1000));
    return took();
  })()`).then((done) => (typeof done === "boolean" ? done : null)),
  )) === true;

/**
 * X's reply sort ("Relevant ⌄") in the post's own article, once X has drawn it. `postId` must be
 * digits; `labels` are X's names for the orders.
 */
const sortMenuAt = (postId: string, labels: ReadonlyArray<string>): MenuAt => ({
  find: `
    ${findArticle(postId)}
    let sortAt = null;
    for (let i = 0; i < 50 && article && !sortAt; i++) {
      sortAt = [...article.querySelectorAll('button[aria-haspopup="menu"]')].find((b) => ${JSON.stringify(labels)}.includes(b.textContent.trim()))?.parentElement ?? null;
      if (!sortAt) await new Promise((r) => setTimeout(r, 100));
    }`,
  root: "sortAt",
  trigger: 'button[aria-haspopup="menu"]',
});

/**
 * Sorts a thread's replies for the user's pick by pressing X's own row `pick.label` under the post,
 * in place on the engine page; X fetches the thread in that order and puts `pick.param` in its URL
 * (`sort_replies`, none for its default). Pushing that URL instead loses the pick while X's first
 * fetch of the thread is still out. True once X's URL carries the pick.
 */
export const xSortReplies = (
  post: PostRef,
  pick: { readonly label: string; readonly param: string | null },
  labels: ReadonlyArray<string>,
) =>
  validPost(post)
    ? xRun(`(async () => {
    ${openMenu(sortMenuAt(post.postId, labels))}
    const item = items.find((i) => i.textContent.trim() === ${JSON.stringify(pick.label)});
    if (!item) return (closeMenu(), false);
    item.click();
    // X puts the order in its URL a moment later; the route's own move waits for it, or it races X.
    const took = () => new URLSearchParams(location.search).get("sort_replies") === ${JSON.stringify(pick.param)};
    for (let i = 0; i < 20 && !took(); i++) await new Promise((r) => setTimeout(r, 100));
    return took();
  })()`).then((done) => done === true)
    : Promise.resolve(false);

/**
 * Votes `choice` in a post's poll for the user's click, pressing X's own radio where the post sits
 * (X asks for no confirm; a vote cannot be changed). True once X drew its results instead.
 */
export const xVote = async (post: PostRef, choice: string) =>
  validPost(post) &&
  (await onPage(postPage(post), () =>
    xRun(`(async () => {
    ${findArticle(post.postId)}
    const poll = () => article?.querySelector('[data-testid="cardPoll"] [role="radiogroup"]');
    if (!poll()) return null;
    const radio = [...poll().querySelectorAll('[role="radio"]')].find((r) => r.textContent.trim() === ${JSON.stringify(choice)});
    if (!radio) return false;
    radio.click();
    for (let i = 0; i < 30 && poll(); i++) await new Promise((r) => setTimeout(r, 100));
    // X shows its results at once and saves a moment later; leaving before then would cancel it.
    await new Promise((r) => setTimeout(r, 1000));
    return !poll();
  })()`).then((voted) => (typeof voted === "boolean" ? voted : null)),
  )) === true;

/** Presses Undo on X's own toast, while X still shows it. True when it was there. */
export const xToastUndo = () =>
  xRun(
    `(() => { const undo = [...document.querySelectorAll('[data-testid="toast"] button, [data-testid="toast"] [role="button"]')].find((b) => b.textContent.trim() === "Undo"); undo?.click(); return !!undo; })()`,
  ).then((done) => done === true);

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
  const moved = await xGo(`https://x.com/${user.handle}`);
  const done = (await xRun(script(100))) === true;
  if (moved)
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
  const moved = await xGo(`https://x.com/${post.handle}/status/${post.postId}`);
  const done = await xActInPlace(post.postId, action);
  // Back only from a page this step opened, and only while the engine is still on it: the user
  // may have been there already, or moved it on meanwhile.
  if (moved)
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

let screenRefresh: (() => void) | null = null;
let lastRefresh = 0;
const REFRESH_FLOOR_MS = 2_000;

/** The open X screen's refresh, set by its column while it shows; returns the unset. */
export const setScreenRefresh = (refresh: () => void) => {
  screenRefresh = refresh;
  return () => {
    if (screenRefresh === refresh) screenRefresh = null;
  };
};

/**
 * ⌘R or F5: the open X screen loads its page from X again, as reloading x.com does. Any other
 * screen reloads the app page, the browser's own refresh.
 */
export const refreshScreen = () => {
  if (screenRefresh === null) return window.location.reload();
  // A full load costs X's Viewer call, which X rate-limits: a hammered key loads once.
  if (Date.now() - lastRefresh < REFRESH_FLOOR_MS) return;
  lastRefresh = Date.now();
  screenRefresh();
};

// DevTools keys skip main's before-input-event, so the engine benchmark presses ⌘R through this.
if (import.meta.env.DEV && typeof window !== "undefined")
  Reflect.set(window, "__xtendRefresh", refreshScreen);
