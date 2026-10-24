import { ipcRenderer } from "electron";

import {
  type Glance,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_DATA_CHANNEL,
  OVERLAY_GLANCE_CHANNEL,
  OVERLAY_HIDE_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  OVERLAY_VIEWER_CHANNEL,
  type OverlayAction,
  type OverlayData,
  type OverlayPost,
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
  viewerHandleFromNav,
} from "./xDom.ts";

/**
 * x.com webview preload: the native injections. A metrics row under every post,
 * the Schedule chip in X's composer toolbar and the hover card. Runs in the
 * isolated world, so x.com's scripts never see it; it only reads the DOM X
 * already rendered and never clicks, scrolls or fetches anything. Post numbers
 * come from the capture through main; the chip shows the "glance" the app
 * pushes. Markup lives in closed shadow roots so x.com's CSS and ours never meet.
 */

const MIN_VIEWS = 100;
/** Same bound as main's feed: the strips only need the posts still near the screen. */
const MAX_POSTS = 2_000;
const HOVER_DELAY_MS = 400;
const HOST_ATTR = "data-xtend-strip";
/** On every element we add to x.com's DOM, so ours are easy to tell apart. */
const OURS = "data-xtend";

// Xtend's tokens: numbers in mono, labels in the system stack, text #f1f3f7 on true black.
const FONT = `-apple-system, "system-ui", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
const STYLE = `
  :host { all: initial; display: block; font-family: ${FONT}; }
  .strip { display: flex; gap: 14px; align-items: center; margin-top: 8px; font: 12px/16px ${MONO}; color: #868a93; }
  .strip b { color: #c4c7ce; font-weight: 400; }
  .up { color: #4ade80; } .down { color: #f87171; }
  .act { margin-left: auto; display: flex; gap: 14px; font: 500 13px/16px ${FONT}; }
  button { all: unset; cursor: pointer; color: #c4c7ce; font: inherit; transition: color 150ms ease; }
  button:hover { color: #f1f3f7; }
  .chips { display: flex; align-items: center; gap: 4px; padding: 0 12px; font: 13px/16px ${FONT}; color: #868a93; white-space: nowrap; }
  .chips button b { color: #f1f3f7; font: 400 12px/16px ${MONO}; }
  .card { position: fixed; z-index: 2147483647; min-width: 180px; padding: 12px 14px; background: #0a0a0b; color: #f1f3f7; border: 1px solid rgba(255,255,255,0.13); border-radius: 12px; font: 14px/20px ${FONT}; display: grid; gap: 4px; }
  .card .h { color: #868a93; font-size: 12.5px; }
  .card .n { font: 12px/16px ${MONO}; }
  .card button { margin-top: 4px; color: #f1f3f7; font-weight: 500; }
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

/** Every x.com mutation rescans; rewriting unchanged markup would relayout each strip every frame of a scroll. */
const render = (el: { body: HTMLElement; html: string }, html: string) => {
  if (el.html === html) return;
  el.html = html;
  el.body.innerHTML = html;
};

const state = {
  posts: new Map<string, OverlayPost>(),
  ownAverage: null as OverlayData["ownAverage"],
  glance: null as Glance | null,
  enabled: true,
  killed: false,
  strips: new Map<string, { host: HTMLElement; body: HTMLElement; html: string }>(),
  chips: [] as Array<{ host: HTMLElement; body: HTMLElement; toolbar: HTMLElement }>,
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
  const html = stripHtml(post);
  body.innerHTML = html;
  body.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    send(
      act === "save"
        ? { type: "save", postId }
        : { type: "openRoute", route: `/compose?reply=${postId}` },
    );
  });
  row.after(host);
  state.strips.set(postId, { host, body, html });
};

const applyVisibility = () => {
  const visible = state.enabled && !state.killed;
  for (const { host } of state.strips.values()) host.hidden = !visible;
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
      send({ type: "openRoute", route });
    });
    post.before(host);
    state.chips.push({ host, body, toolbar });
  }
};

const renderGlance = () => {
  for (const chip of state.chips) chip.body.innerHTML = chipsHtml();
};

// Who is signed in, for observations and the service's handle; sent once per change.
let viewer: string | null = null;
const reportViewer = () => {
  const handle = viewerHandleFromNav(document);
  if (handle === null || handle === viewer) return;
  viewer = handle;
  ipcRenderer.send(OVERLAY_VIEWER_CHANNEL, handle);
};

let scanQueued = false;
const scan = () => {
  scanQueued = false;
  reportViewer();
  mountChips();
  // X unmounts articles scrolled far away; their strips go with them and must not pile up here.
  for (const [postId, strip] of state.strips)
    if (!strip.host.isConnected) state.strips.delete(postId);
  for (const article of findArticles(document)) {
    const postId = articlePostId(article);
    if (postId === null) continue;
    const post = state.posts.get(postId);
    const strip = state.strips.get(postId);
    if (post === undefined || !shouldShow(post)) {
      strip?.host.remove();
      continue;
    }
    if (strip !== undefined) render(strip, stripHtml(post));
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
  host.setAttribute(OURS, "card");
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
    body.innerHTML = `<div><b>@${handle}</b>${post.authorVerified ? " ✓" : ""}</div><div><span class="h">followers</span> <span class="n">${post.authorFollowers === null ? "–" : compact(post.authorFollowers)}</span></div><div><button data-act="report">Full report</button></div>`;
    document.body.append(host);
  };
  // Score numbers come only from the Scores screen: nothing is fetched on hover.
  body.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.act !== "report") return;
    send({ type: "openRoute", route: `/scores?handle=${shownHandle}` });
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
  for (const id of state.posts.keys()) {
    if (state.posts.size <= MAX_POSTS) break;
    state.posts.delete(id);
  }
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

window.addEventListener("DOMContentLoaded", () => {
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  queueScan();
});
