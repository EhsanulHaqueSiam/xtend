/**
 * The X skin: CSS main inserts into the x.com webview so X reads as part of
 * Xtend. CSS only, never script: x.com's own code runs untouched, nothing is
 * clicked or fetched, and the page behaves exactly as it would in Chromium.
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
div[data-testid="GrokDrawer"], div[data-testid="chat-drawer-root"] { display: none !important; }
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

// Upsells and Grok entry points that survive in the timeline column. The per-post button has
// no test id, only a label, so it hides in English only.
const PROMPTS = `
a[href="/i/premium_sign_up"], a[href="/i/verified-choose"], a[href^="/i/grok"], a[href="/i/premium-business"] { display: none !important; }
button[data-testid="grokImgGen"], button[aria-label="Grok actions"] { display: none !important; }
`;

// Scrollbars and selection in Xtend's tokens; Linux would otherwise draw classic grey bars.
const CHROME = `
html { scrollbar-width: thin; scrollbar-color: #222 transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: #222; border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: #363636; }
::selection { background: rgba(91, 141, 239, 0.35); }
`;

export const X_SKIN_CSS = [LEGACY, SEMANTIC, PROMPTS, CHROME].join("\n");
