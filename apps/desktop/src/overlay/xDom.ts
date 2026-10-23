/**
 * Everything the overlay knows about x.com's markup, in one place. X renames
 * test ids and reshuffles wrappers every few months; when the fixture test in
 * xDom.browser.test.ts fails, bump the version and fix the selectors here.
 */
export const X_DOM_VERSION = "2026-10";

const ARTICLE = 'article[data-testid="tweet"]';
const STATUS_LINK = 'a[href*="/status/"]';
const ACTION_ROW = 'div[role="group"]';
const USER_NAME = 'div[data-testid="User-Name"]';
const AVATAR = 'div[data-testid^="Tweet-User-Avatar"]';
const STATUS_ID = /\/status\/(\d+)/;
const PRIMARY_COLUMN = 'div[data-testid="primaryColumn"]';
const RAIL_HOME =
  'header[role="banner"] nav[role="navigation"] a[data-testid="AppTabBar_Home_Link"]';
const RAIL_TAIL =
  'header[role="banner"] nav[role="navigation"] :is(a[data-testid="premium-signup-tab"], a[data-testid="AppTabBar_Profile_Link"], button[data-testid="AppTabBar_More_Menu"])';
const TOOLBAR = 'div[data-testid="toolBar"]';
// The editable node itself: X wraps it in a "_label" and a "RichTextInputContainer" with the same prefix, and the label carries the placeholder.
const COMPOSER_TEXT = 'div[data-testid^="tweetTextarea_"][contenteditable="true"]';
const SIDEBAR = 'div[data-testid="sidebarColumn"]';
const SIDEBAR_FIRST = `${SIDEBAR} :is(aside, section[role="region"])`;

/** Main pads X's rail below the macOS traffic lights; the window has no title bar of its own. */
export const BANNER_INSET_CSS = 'header[role="banner"] > div > div { padding-top: 28px; }';

/** X's main column (timeline, post, profile); the center and bar slots are drawn over it. Null on DMs and settings. */
export const primaryColumn = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>(PRIMARY_COLUMN);

export const findArticles = (root: ParentNode): ReadonlyArray<HTMLElement> =>
  Array.from(root.querySelectorAll<HTMLElement>(ARTICLE));

/**
 * The post id of an article: the permalink wrapping its timestamp. A quoted
 * post inside the article has no anchor around its time, so the first match
 * belongs to the outer post.
 */
export function articlePostId(article: Element): string | null {
  for (const link of article.querySelectorAll<HTMLAnchorElement>(STATUS_LINK)) {
    if (link.querySelector("time") === null) continue;
    const id = STATUS_ID.exec(link.getAttribute("href") ?? "")?.[1];
    if (id !== undefined) return id;
  }
  return null;
}

/** The reply / repost / like / views row; the strip goes right after it. */
export const articleActionRow = (article: Element): HTMLElement | null =>
  article.querySelector<HTMLElement>(ACTION_ROW);

/** The author's handle from the name block, without the @. */
export function articleAuthorHandle(article: Element): string | null {
  const names = article.querySelector(USER_NAME);
  const text = names?.textContent ?? "";
  return /@([A-Za-z0-9_]{1,15})/.exec(text)?.[1] ?? null;
}

/** Elements that open the hover card: avatar and the name block. */
export const articleHoverTargets = (article: Element): ReadonlyArray<HTMLElement> =>
  Array.from(article.querySelectorAll<HTMLElement>(`${AVATAR}, ${USER_NAME}`));

/** X's "Home" rail item: the Xtend item is a clone of it, so it inherits X's styles and icon-only collapse. */
export const railTemplate = (root: ParentNode): HTMLAnchorElement | null =>
  root.querySelector<HTMLAnchorElement>(RAIL_HOME);

/** The first of Premium, Profile, More: the Xtend item goes right before it, where X keeps its own extras. */
export const railTail = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>(RAIL_TAIL);

/** Every composer toolbar on the page (home inline, reply inline, the modal); the chips go between its icons and Post. */
export const composerToolbars = (root: ParentNode): ReadonlyArray<HTMLElement> =>
  Array.from(root.querySelectorAll<HTMLElement>(TOOLBAR));

/** The editable text of the composer a toolbar belongs to: the nearest ancestor holding one. */
export function composerText(toolbar: Element): HTMLElement | null {
  for (let node = toolbar.parentElement; node !== null; node = node.parentElement) {
    const text = node.querySelector<HTMLElement>(COMPOSER_TEXT);
    if (text !== null) return text;
  }
  return null;
}

/** The first rounded card in X's right column (Premium or Trending); the Today card goes above it. */
export function sidebarFirstCard(root: ParentNode): HTMLElement | null {
  const first = root.querySelector<HTMLElement>(SIDEBAR_FIRST);
  const card = first?.parentElement ?? null;
  return card !== null && card.getAttribute("data-testid") !== "sidebarColumn" ? card : null;
}

/** Direct messages never get a strip. */
export const isDmPath = (pathname: string): boolean => pathname.startsWith("/messages");
