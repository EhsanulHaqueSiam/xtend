import { ipcRenderer } from "electron";

import {
  COLUMN_RECT_CHANNEL,
  EDITING_CHANNEL,
  type Glance,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_DATA_CHANNEL,
  OVERLAY_GLANCE_CHANNEL,
  OVERLAY_HIDE_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  POINTER_DOWN_CHANNEL,
  type OverlayAction,
  type OverlayData,
  type ColumnRects,
  type OverlayPost,
  type Rect,
} from "../ipc/channels.ts";
import {
  X_DOM_VERSION,
  articleActionRow,
  articleAuthorHandle,
  articleHoverTargets,
  articlePostId,
  composerText,
  composerToolbars,
  findArticles,
  isDmPath,
  primaryColumn,
  railTail,
  railTemplate,
  sidebarColumn,
  sidebarFirstCard,
} from "./xDom.ts";

/**
 * x.com preload: the native injections. A metrics row under every post, the
 * "Xtend" rail item, the Schedule chip in X's composer toolbar, the Today
 * card in X's right column and the hover card, plus the column rect main
 * needs to place the xtend view. Runs in the isolated world, so x.com's
 * scripts never see it. Post numbers come from the capture through main; the
 * Today card and chips show the "glance" the app view pushes. Markup lives in
 * closed shadow roots so x.com's CSS and ours never meet; the rail item is the
 * one exception, a clone of X's own item so it inherits X's styles.
 */

const MIN_VIEWS = 100;
const HOVER_DELAY_MS = 400;
const HOST_ATTR = "data-xtend-strip";
/** On every element we add to x.com's DOM: pointer-downs inside them must not dismiss the open slot. */
const OURS = "data-xtend";

// X's own type: system stack, 13px grey for secondary rows, 15px for body text, 20px/800 for card titles.
const FONT = `-apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const STYLE = `
  :host { all: initial; display: block; font-family: ${FONT}; }
  .strip { display: flex; gap: 16px; align-items: center; margin-top: 8px; font: 13px/16px ${FONT}; color: #71767b; }
  .strip b { color: #e7e9ea; font-weight: 400; }
  .up { color: #00ba7c; } .down { color: #f4212e; }
  .act { margin-left: auto; display: flex; gap: 16px; }
  button { all: unset; cursor: pointer; color: #71767b; font: inherit; }
  button:hover { color: #1d9bf0; }
  .chips { display: flex; align-items: center; gap: 4px; padding: 0 12px; font: 13px/16px ${FONT}; color: #71767b; white-space: nowrap; }
  .chips button b { color: #e7e9ea; font-weight: 400; }
  .chips button:hover b { color: #1d9bf0; }
  .today { margin-bottom: 16px; border: 1px solid #2f3336; border-radius: 16px; background: #000; overflow: hidden; font: 15px/20px ${FONT}; color: #e7e9ea; }
  .today h2 { margin: 0; padding: 12px 16px; font: 800 20px/24px ${FONT}; }
  .today .row { display: block; width: 100%; box-sizing: border-box; padding: 12px 16px; color: #e7e9ea; text-decoration: none; }
  .today .row:hover { background: rgba(255,255,255,0.03); color: #e7e9ea; }
  .today .k { display: block; font-size: 13px; line-height: 16px; color: #71767b; }
  .today .v { display: block; font-weight: 700; }
  .today .warn { color: #ffd400; }
  .card { position: fixed; z-index: 2147483647; min-width: 180px; padding: 12px 16px; background: #000; color: #e7e9ea; border: 1px solid #2f3336; border-radius: 16px; font: 15px/20px ${FONT}; box-shadow: 0 0 15px rgba(255,255,255,0.2); }
  .card .h { color: #71767b; font-size: 13px; }
  .card button { color: #1d9bf0; }
`;

/** A closed shadow root with our stylesheet; `cls` names the body's block. */
const shadowHost = (cls: string) => {
  const host = document.createElement("div");
  host.setAttribute(OURS, cls);
  host.setAttribute("data-xtend-dom", X_DOM_VERSION);
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const body = document.createElement("div");
  body.className = cls;
  root.append(style, body);
  return { host, body };
};

const compact = (n: number): string =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e4
      ? `${Math.round(n / 1e3)}K`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}K`
        : String(Math.round(n));

const engagementRate = (p: OverlayPost): number | null =>
  p.views === null || p.views === 0
    ? null
    : (p.likes + p.reposts + p.replies + p.quotes + p.bookmarks) / p.views;

const viewsPerHour = (p: OverlayPost, now: number): number | null => {
  const hours = (now - Date.parse(p.createdAt)) / 3_600_000;
  return p.views === null || !(hours > 0) ? null : p.views / Math.max(hours, 1 / 60);
};

/** Promoted posts, DMs and posts under the view floor get nothing. */
const shouldShow = (p: OverlayPost): boolean =>
  !p.isPromoted && p.views !== null && p.views >= MIN_VIEWS && !isDmPath(location.pathname);

const send = (action: OverlayAction) => ipcRenderer.send(OVERLAY_ACTION_CHANNEL, action);

const state = {
  posts: new Map<string, OverlayPost>(),
  ownAverage: null as OverlayData["ownAverage"],
  glance: null as Glance | null,
  enabled: true,
  killed: false,
  strips: new Map<string, { host: HTMLElement; body: HTMLElement }>(),
  chips: [] as Array<{ host: HTMLElement; body: HTMLElement; toolbar: HTMLElement }>,
  rail: null as HTMLElement | null,
  today: null as { host: HTMLElement; body: HTMLElement } | null,
};

const stripHtml = (p: OverlayPost): string => {
  const er = engagementRate(p);
  const vph = viewsPerHour(p, Date.now());
  // Unknown values are left out rather than dashed, as X does with its own counts.
  const cells = [`<span><b>${compact(p.views ?? 0)}</b> views</span>`];
  if (er !== null) cells.push(`<span><b>${(er * 100).toFixed(1)}%</b> ER</span>`);
  if (vph !== null) cells.push(`<span><b>${compact(vph)}</b>/h</span>`);
  if (p.authorFollowers !== null)
    cells.push(`<span><b>${compact(p.authorFollowers)}</b> followers</span>`);
  if (p.isOwn && state.ownAverage !== null && state.ownAverage.views > 0 && p.views !== null) {
    const delta = Math.round(((p.views - state.ownAverage.views) / state.ownAverage.views) * 100);
    cells.push(
      `<span class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${delta}% vs your avg</span>`,
    );
  }
  return `${cells.join("")}<span class="act"><button data-act="save">Save</button><button data-act="reply">Reply with AI</button></span>`;
};

const mountStrip = (article: HTMLElement, postId: string, post: OverlayPost) => {
  const row = articleActionRow(article);
  if (row === null) return;
  const { host, body } = shadowHost("strip");
  host.setAttribute(HOST_ATTR, postId);
  body.innerHTML = stripHtml(post);
  body.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    send(
      act === "save"
        ? { type: "save", postId }
        : { type: "openSlot", slot: { kind: "center", route: `/compose?reply=${postId}` } },
    );
  });
  row.after(host);
  state.strips.set(postId, { host, body });
};

const applyVisibility = () => {
  const visible = state.enabled && !state.killed;
  for (const { host } of state.strips.values()) host.hidden = !visible;
};

// Rail item: X's Home item cloned, relabelled and pointed at the center slot. The clone drops
// the test id so the next scan does not clone the clone; X remounts the nav on some routes, so
// the scan re-adds it whenever it is gone.
const XTEND_ICON =
  '<path d="M4 4h5l3 4.5L15 4h5l-6.5 8L20 20h-5l-3-4.5L9 20H4l6.5-8L4 4z" fill="currentColor"/>';
const mountRail = () => {
  if (state.rail?.isConnected) return;
  const template = railTemplate(document);
  const tail = railTail(document);
  if (template === null || tail === null) return;
  const item = template.cloneNode(true) as HTMLAnchorElement;
  item.removeAttribute("data-testid");
  item.setAttribute(OURS, "rail");
  item.href = "#xtend";
  item.setAttribute("aria-label", "Xtend");
  const label = item.querySelector("span");
  if (label !== null) label.textContent = "Xtend";
  // Home is usually the active item, so its clone would come out bold.
  const text = label?.parentElement;
  if (text !== undefined && text !== null) text.style.fontWeight = "400";
  const svg = item.querySelector("svg");
  if (svg !== null) {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.innerHTML = `<g>${XTEND_ICON}</g>`;
  }
  item.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    send({ type: "openSlot", slot: { kind: "center", route: "/plan" } });
  });
  tail.before(item);
  state.rail = item;
};

// Composer chips: "Schedule · <best time>" between X's icons and Post, in every composer. Schedule
// carries the typed text into the Compose tab; simple posts never leave X's composer.
const chipsHtml = () => {
  const best = state.glance?.bestTime;
  return `<button data-act="schedule">Schedule${best === undefined || best === null ? "" : ` · <b>${best}</b>`}</button>`;
};
const mountChips = () => {
  state.chips = state.chips.filter((c) => c.host.isConnected);
  for (const toolbar of composerToolbars(document)) {
    if (state.chips.some((c) => c.toolbar === toolbar)) continue;
    const post = toolbar.lastElementChild;
    if (post === null) continue;
    const { host, body } = shadowHost("chips");
    body.innerHTML = chipsHtml();
    // Pointer-down, not click: focusing a collapsed composer makes X remount the toolbar
    // before the click would fire. preventDefault keeps X's editor from losing focus.
    body.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("[data-act]") === null) return;
      e.preventDefault();
      const text = composerText(toolbar)?.innerText.trim() ?? "";
      const route = text === "" ? "/compose?new=1" : `/compose?text=${encodeURIComponent(text)}`;
      send({ type: "openSlot", slot: { kind: "center", route } });
    });
    post.before(host);
    state.chips.push({ host, body, toolbar });
  }
};

// Today card: X's card shape above Premium or Trending in the right column. Every row opens a tab.
const todayHtml = (g: Glance): string => {
  const row = (route: string, k: string, v: string, cls = "") =>
    `<a class="row" href="#xtend" data-route="${route}"><span class="k">${k}</span><span class="v ${cls}">${v}</span></a>`;
  const rows = [
    row(
      "/plan",
      "Queue",
      g.queued === 0 ? "Nothing queued" : `${g.queued} queued · next ${g.nextScheduled ?? ""}`,
    ),
    row(
      "/engage",
      "Engage",
      g.mentions === 0 ? "No open mentions" : `${g.mentions} mentions to answer`,
    ),
    row("/settings", "Spend", `$${g.spendTodayUsd.toFixed(2)} today`),
  ];
  if (!g.connected) rows.push(row("/settings", "Service", "Unreachable, retrying", "warn"));
  return `<h2>Today</h2>${rows.join("")}`;
};
const mountToday = () => {
  if (state.glance === null) return;
  if (state.today?.host.isConnected) {
    state.today.body.innerHTML = todayHtml(state.glance);
    return;
  }
  const card = sidebarFirstCard(document);
  if (card === null) return;
  const { host, body } = shadowHost("today");
  body.innerHTML = todayHtml(state.glance);
  body.addEventListener("click", (e) => {
    const route = (e.target as HTMLElement).closest<HTMLElement>("[data-route]")?.dataset.route;
    if (route === undefined) return;
    e.preventDefault();
    send({ type: "openSlot", slot: { kind: "center", route } });
  });
  card.before(host);
  state.today = { host, body };
};
const renderGlance = () => {
  for (const chip of state.chips) chip.body.innerHTML = chipsHtml();
  mountToday();
};

// Column rects: main places the center and bar slots over X's primary column, and wide slots
// (Compose) over the right column too. X remounts both on route changes, so every scan re-finds
// them; the observer follows size changes and the resize listener the position.
const tracked: { column: HTMLElement | null; sidebar: HTMLElement | null } = {
  column: null,
  sidebar: null,
};
let lastColumn = "";
const box = (el: HTMLElement | null): Rect | null => {
  if (el === null || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};
const reportColumn = () => {
  const value: ColumnRects = { column: box(tracked.column), sidebar: box(tracked.sidebar) };
  const key = JSON.stringify(value);
  if (key === lastColumn) return;
  lastColumn = key;
  ipcRenderer.send(COLUMN_RECT_CHANNEL, value);
};
const columnObserver = new ResizeObserver(reportColumn);
const trackColumn = () => {
  const found = { column: primaryColumn(document), sidebar: sidebarColumn(document) };
  if (found.column !== tracked.column || found.sidebar !== tracked.sidebar) {
    columnObserver.disconnect();
    Object.assign(tracked, found);
    for (const el of [tracked.column, tracked.sidebar]) if (el !== null) columnObserver.observe(el);
  }
  reportColumn();
};
window.addEventListener("resize", reportColumn);

let scanQueued = false;
const scan = () => {
  scanQueued = false;
  trackColumn();
  mountRail();
  mountChips();
  mountToday();
  for (const article of findArticles(document)) {
    const postId = articlePostId(article);
    if (postId === null) continue;
    const post = state.posts.get(postId);
    const strip = state.strips.get(postId);
    if (strip !== undefined && !strip.host.isConnected) state.strips.delete(postId);
    if (post === undefined || !shouldShow(post)) {
      strip?.host.remove();
      continue;
    }
    if (strip !== undefined && strip.host.isConnected) strip.body.innerHTML = stripHtml(post);
    else mountStrip(article, postId, post);
    if (article.dataset.xtendHover === undefined) {
      article.dataset.xtendHover = "1";
      for (const target of articleHoverTargets(article)) attachHover(target, postId, article);
    }
  }
  applyVisibility();
};
const queueScan = () => {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(scan);
};

// Hover card: one element for the page, shown 400 ms after the pointer rests on an avatar or name.
const card = (() => {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const body = document.createElement("div");
  body.className = "card";
  root.append(style, body);
  let pinned = false;
  let shownHandle = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    if (pinned) return;
    host.remove();
  };
  const show = (target: Element, postId: string, handle: string) => {
    const post = state.posts.get(postId);
    if (post === undefined || !state.enabled || state.killed) return;
    const rect = target.getBoundingClientRect();
    body.style.left = `${Math.round(rect.left)}px`;
    body.style.top = `${Math.round(rect.bottom + 4)}px`;
    shownHandle = handle;
    body.innerHTML = `<div><b>@${handle}</b>${post.authorVerified ? " ✓" : ""}</div><div><span class="h">followers</span> ${post.authorFollowers === null ? "–" : compact(post.authorFollowers)}</div><div><button data-act="report">Full report</button></div>`;
    document.body.append(host);
  };
  // Score numbers come only from the Scores screen: nothing is fetched on hover.
  body.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.act !== "report") return;
    send({ type: "openSlot", slot: { kind: "center", route: `/scores?handle=${shownHandle}` } });
    pinned = false;
    hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      pinned = false;
      hide();
    }
  });
  document.addEventListener("click", (e) => {
    if (pinned && e.composedPath()[0] !== body && !body.contains(e.target as Node)) {
      pinned = false;
      hide();
    }
  });
  return {
    schedule: (target: Element, postId: string, handle: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => show(target, postId, handle), HOVER_DELAY_MS);
    },
    cancel: hide,
    pin: () => {
      pinned = host.isConnected;
      return pinned;
    },
  };
})();

const attachHover = (target: HTMLElement, postId: string, article: Element) => {
  const handle = () => state.posts.get(postId)?.authorHandle ?? articleAuthorHandle(article);
  target.addEventListener("mouseenter", () => {
    const h = handle();
    if (h !== null) card.schedule(target, postId, h);
  });
  target.addEventListener("mouseleave", card.cancel);
  // A click while the card is open pins it instead of leaving for the profile.
  target.addEventListener(
    "click",
    (e) => {
      if (card.pin()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
};

ipcRenderer.on(OVERLAY_DATA_CHANNEL, (_event, data: OverlayData) => {
  for (const [id, post] of Object.entries(data.posts)) state.posts.set(id, post);
  state.ownAverage = data.ownAverage;
  queueScan();
});
ipcRenderer.on(OVERLAY_TOGGLE_CHANNEL, () => {
  state.enabled = !state.enabled;
  applyVisibility();
});
ipcRenderer.on(OVERLAY_HIDE_CHANNEL, (_event, hidden: boolean) => {
  state.killed = hidden;
  applyVisibility();
});
ipcRenderer.on(OVERLAY_GLANCE_CHANNEL, (_event, glance: Glance) => {
  state.glance = glance;
  renderGlance();
});

// Main gates single-letter shortcuts on this: typing in x.com's composer must stay typing.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
window.addEventListener("focusin", (e) => ipcRenderer.send(EDITING_CHANNEL, isEditable(e.target)));
window.addEventListener("focusout", () => ipcRenderer.send(EDITING_CHANNEL, false));
// Capture phase: x.com stops propagation on some of its own controls, and main must still hear it.
// A press on one of our own elements (closed roots show up as their host) keeps the slot open.
const isOurs = (node: EventTarget) => node instanceof Element && node.hasAttribute(OURS);
window.addEventListener(
  "pointerdown",
  (e) => {
    if (!e.composedPath().some(isOurs)) ipcRenderer.send(POINTER_DOWN_CHANNEL);
  },
  true,
);

window.addEventListener("DOMContentLoaded", () => {
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  queueScan();
});
