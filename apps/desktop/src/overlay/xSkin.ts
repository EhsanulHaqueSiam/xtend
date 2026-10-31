import { type XSkinToggle, X_SKIN_DEFAULTS } from "@xtend/contracts";

/**
 * The X skin: CSS main inserts into the x.com webview so X reads as part of
 * Xtend. CSS only, never script: x.com's own code runs untouched, nothing is
 * clicked or fetched, and the page behaves exactly as it would in Chromium.
 * Each Clean X toggle is one rule set here; Settings sends the enabled ids.
 *
 * Xtend's sidebar replaces X's navigation (and its floating Messages drawer)
 * and its tools replace X's right column (trends, who to follow, Premium and
 * Grok prompts), so all of them are hidden and the timeline is centred. X serves two clients at the moment: the
 * long-standing one keyed by data-testid, and a newer one built from semantic
 * `main` and `aside` elements in a grid. Each has its own block; a rule whose
 * landmark is missing simply matches nothing.
 */

// The legacy client: X's nav rail, its right column and the primary column between them.
const LEGACY = `
header[role="banner"] { display: none !important; }
div[data-testid="sidebarColumn"] { display: none !important; }
main[role="main"] { align-items: center !important; }
main[role="main"] > div { width: 100% !important; max-width: 640px !important; }
div[data-testid="primaryColumn"] { max-width: 640px !important; width: 100% !important; border-left-width: 0 !important; border-right-width: 0 !important; }
`;

// The newer client: a flex row holding the nav wrapper and a grid of main plus aside.
// :has() cannot nest, so the row is found by its grid's main + aside pair; that pair also keeps
// the rule away from the legacy client, whose layers div (menus, modals) sits beside main's parent.
const SEMANTIC = `
div:has(> div > main + aside) > div:not(:has(main)) { display: none !important; }
div:has(> main):has(> aside) { grid-template-columns: minmax(0, 1fr) !important; }
div:has(> main):has(> aside) > aside { display: none !important; }
div:has(> main + aside) > main { max-width: 640px !important; border-left-width: 0 !important; border-right-width: 0 !important; }
`;

// Grok's drawer and its entry points in the timeline column. The per-post button has no test id,
// only a label, so it hides in English only.
const GROK = `
div[data-testid="GrokDrawer"], div[data-testid="chat-drawer-root"] { display: none !important; }
a[href^="/i/grok"], button[data-testid="grokImgGen"], button[aria-label="Grok actions"] { display: none !important; }
`;

// Premium upsells: links anywhere, and the timeline cells that exist only to carry one.
const UPSELLS = `
a[href^="/i/premium"], a[href="/i/verified-choose"] { display: none !important; }
div[data-testid="cellInnerDiv"]:has(a[href^="/i/premium"]) { display: none !important; }
`;

// Promoted posts carry a placement tracker around the post. Every video player carries one too,
// inside its media, so a tracker inside tweetPhoto is not an ad; matching any tracker hid every
// post with a video. The capture still records promoted posts as promoted.
const ADS = `
div[data-testid="cellInnerDiv"]:has([data-testid="placementTracking"]:not([data-testid="tweetPhoto"] *)) { display: none !important; }
`;

// Under a thread, the heading cell ("Discover more", "More posts") and every cell after it.
// Scoped to the conversation timeline so a heading cell on /home hides nothing.
const DISCOVER = `
div[aria-label="Timeline: Conversation"] div[data-testid="cellInnerDiv"]:has(h2) { display: none !important; }
div[aria-label="Timeline: Conversation"] div[data-testid="cellInnerDiv"]:has(h2) ~ div[data-testid="cellInnerDiv"] { display: none !important; }
`;

// Subscribe buttons on posts and profiles. shortcut: label match, English only; add a test id when X gives one.
const BOOSTS = `
button[aria-label^="Subscribe"], a[href$="/superfollows/subscribe"] { display: none !important; }
`;

const EXTRAS = `
a[href="/i/communities"], a[href="/jobs"], a[href^="/i/spaces"] { display: none !important; }
`;

// The first tab of the Home tab list. X remembers the last chosen tab, so Following stays.
const FOR_YOU = `
div[role="tablist"]:has(a[href="/home"]) > div:first-child { display: none !important; }
`;

const VIEWS = `
article a[href$="/analytics"] { display: none !important; }
`;

const BADGES = `
svg[data-testid="icon-verified"] { display: none !important; }
`;

const QUIET_MEDIA = `
article [data-testid="tweetPhoto"], article [data-testid="videoPlayer"] { opacity: 0.6; transition: opacity 150ms ease; }
article:hover [data-testid="tweetPhoto"], article:hover [data-testid="videoPlayer"] { opacity: 1; }
`;

// Scrollbars and selection in Xtend's tokens; Linux would otherwise draw classic grey bars.
const CHROME = `
html { scrollbar-width: thin; scrollbar-color: #222 transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: #222; border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: #363636; }
::selection { background: rgba(91, 141, 239, 0.35); }
`;

const RULES: Record<XSkinToggle, string> = {
  ads: ADS,
  grok: GROK,
  upsells: UPSELLS,
  chrome: LEGACY + SEMANTIC,
  discover: DISCOVER,
  boosts: BOOSTS,
  extras: EXTRAS,
  forYou: FOR_YOU,
  views: VIEWS,
  badges: BADGES,
  quietMedia: QUIET_MEDIA,
};

/** The skin for the enabled toggles; scrollbars and selection are always Xtend's. */
export const xSkinCss = (on: ReadonlyArray<XSkinToggle>) =>
  [...on.map((id) => RULES[id]), CHROME].join("\n");

export const X_SKIN_CSS = xSkinCss(X_SKIN_DEFAULTS);
