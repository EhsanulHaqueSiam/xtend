import { ipcRenderer } from "electron";

import {
  EDITING_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_DATA_CHANNEL,
  OVERLAY_HIDE_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
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
  findArticles,
  isDmPath,
} from "./xDom.ts";

/**
 * Session view preload: draws the metrics strip and hover card over x.com's
 * posts. Runs in the isolated world, so x.com's scripts never see it; every
 * number comes from the main process, which got it from the capture. Markup
 * lives in closed shadow roots so x.com's CSS and ours never meet.
 */

const MIN_VIEWS = 100;
const HOVER_DELAY_MS = 400;
const HOST_ATTR = "data-xtend-strip";

const STYLE = `
  :host { all: initial; display: block; }
  .strip { display: flex; gap: 10px; align-items: center; padding: 4px 0 2px; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #71767b; }
  .strip b { color: #e7e9ea; font-weight: 500; }
  .up { color: #00ba7c; } .down { color: #f4212e; }
  .act { margin-left: auto; display: flex; gap: 8px; }
  button { all: unset; cursor: pointer; color: #1d9bf0; font: inherit; }
  button:hover { text-decoration: underline; }
  .card { position: fixed; z-index: 2147483647; min-width: 180px; padding: 8px 10px; background: #000; color: #e7e9ea; border: 1px solid #2f3336; border-radius: 6px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 4px 16px rgba(0,0,0,.6); }
  .card .h { color: #71767b; }
`;

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
  enabled: true,
  killed: false,
  strips: new Map<string, { host: HTMLElement; body: HTMLElement }>(),
};

const stripHtml = (p: OverlayPost): string => {
  const er = engagementRate(p);
  const vph = viewsPerHour(p, Date.now());
  const cells = [
    `<span><b>${compact(p.views ?? 0)}</b> views</span>`,
    `<span><b>${er === null ? "–" : `${(er * 100).toFixed(1)}%`}</b> ER</span>`,
    `<span><b>${vph === null ? "–" : compact(vph)}</b>/h</span>`,
    `<span><b>${p.authorFollowers === null ? "–" : compact(p.authorFollowers)}</b> followers</span>`,
  ];
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
  const host = document.createElement("div");
  host.setAttribute(HOST_ATTR, postId);
  host.setAttribute("data-xtend-dom", X_DOM_VERSION);
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const body = document.createElement("div");
  body.className = "strip";
  body.innerHTML = stripHtml(post);
  body.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    send(
      act === "save"
        ? { type: "save", postId }
        : { type: "openRoute", href: `/compose?reply=${postId}` },
    );
  });
  root.append(style, body);
  row.after(host);
  state.strips.set(postId, { host, body });
};

const applyVisibility = () => {
  const visible = state.enabled && !state.killed;
  for (const { host } of state.strips.values()) host.hidden = !visible;
};

let scanQueued = false;
const scan = () => {
  scanQueued = false;
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
    send({ type: "openRoute", href: `/scores?handle=${shownHandle}` });
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

// Main gates single-letter shortcuts on this: typing in x.com's composer must stay typing.
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
window.addEventListener("focusin", (e) => ipcRenderer.send(EDITING_CHANNEL, isEditable(e.target)));
window.addEventListener("focusout", () => ipcRenderer.send(EDITING_CHANNEL, false));

window.addEventListener("DOMContentLoaded", () => {
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  queueScan();
});
