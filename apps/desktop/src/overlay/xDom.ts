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

/** Direct messages never get a strip. */
export const isDmPath = (pathname: string): boolean => pathname.startsWith("/messages");
