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
const PROFILE_LINK = 'a[data-testid="AppTabBar_Profile_Link"]';
const HANDLE_PATH = /^\/([A-Za-z0-9_]{1,15})$/;
const ACCOUNT_PICTURE = '[data-testid="SideNav_AccountSwitcher_Button"] img';
const TOOLBAR = 'div[data-testid="toolBar"]';
// The editable node itself: X wraps it in a "_label" and a "RichTextInputContainer" with the same prefix, and the label carries the placeholder.
const COMPOSER_TEXT = 'div[data-testid^="tweetTextarea_"][contenteditable="true"]';

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

/**
 * The signed-in account, from X's nav (still in the DOM while the skin hides it): the handle from
 * the Profile link, the name and avatar from the account switcher's picture. X's own Viewer call
 * carries them too, but X makes it only now and then.
 */
export function viewerFromNav(
  root: ParentNode,
): { handle: string; name: string | null; avatarUrl: string | null } | null {
  const href = root.querySelector<HTMLAnchorElement>(PROFILE_LINK)?.getAttribute("href") ?? "";
  const handle = HANDLE_PATH.exec(href)?.[1]?.toLowerCase();
  if (handle === undefined) return null;
  const picture = root.querySelector<HTMLImageElement>(ACCOUNT_PICTURE);
  const src = picture?.getAttribute("src") ?? "";
  return {
    handle,
    name: picture?.getAttribute("alt") || null,
    // The switcher shows the smallest size; every other avatar in the engine is _normal.
    avatarUrl: src.startsWith("https://pbs.twimg.com/")
      ? src.replace(/_mini(\.\w+)$/, "_normal$1")
      : null,
  };
}

/** Direct messages never get a strip: the classic inbox and X's Chat, which replaced it in 2025. */
export const isDmPath = (pathname: string): boolean => /^\/(messages|i\/chat)(\/|$)/.test(pathname);

/**
 * X's composer controls the desktop presses for a post the user clicked (DesktopCommands). Read
 * live from x.com/compose/post on 2026-11-02: the reply button's "Everyone can reply" and
 * `createPollButton`. The rest is unconfirmed until checked live: the reply menu's rows, the
 * reply button's label after a pick, the poll's choice inputs, its add button and its selects.
 */
export const X_COMPOSER = {
  replyButton: '[aria-label="Everyone can reply"]',
  /** Unconfirmed: the button X shows once the row took. */
  replyButtonFor: (row: string) => `[aria-label="${row} can reply"]`,
  /** Unconfirmed: X's dropdown rows carry no test id, so the driver matches their text. */
  menuRow: '[role="menuitem"]',
  addPoll: '[data-testid="createPollButton"]',
  /** Unconfirmed: X names the inputs behind its "Choice 1", "Choice 2" labels. */
  choice: (n: number) => `input[name="Choice${n}"]`,
  /** Unconfirmed: the + beside the last choice. */
  addChoice: '[aria-label="Add a choice"]',
  /** Unconfirmed: "Poll length" as Days, Hours and Minutes selects. */
  pollDays: 'select[data-testid="selectPollDays"]',
  pollHours: 'select[data-testid="selectPollHours"]',
  pollMinutes: 'select[data-testid="selectPollMinutes"]',
} as const;

/** X's reply menu rows, by the setting each one picks; "Everyone" is X's default and never pressed. */
export const X_REPLY_ROWS = {
  following: "Accounts you follow",
  verified: "Verified accounts",
  mentionedUsers: "Only accounts you mention",
} as const;
