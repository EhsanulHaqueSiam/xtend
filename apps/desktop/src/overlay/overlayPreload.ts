import type { Mark, ReplyTone } from "@xtend/contracts";
import { ipcRenderer } from "electron";

import {
  type Glance,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_DATA_CHANNEL,
  OVERLAY_GLANCE_CHANNEL,
  OVERLAY_HIDE_CHANNEL,
  OVERLAY_MARKS_CHANNEL,
  OVERLAY_REPLY_CHANNEL,
  OVERLAY_SAVE_CHANNEL,
  type OverlaySave,
  OVERLAY_TOGGLE_CHANNEL,
  OVERLAY_VIEWER_CHANNEL,
  type OverlayAction,
  type OverlayData,
  type OverlayMarks,
  type OverlayPost,
  type OverlayReply,
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
  viewerFromNav,
} from "./xDom.ts";
import { emptyPanel, panelHtml, type ReplyPanel } from "./replyPanel.ts";

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
  .mark { color: #f1f3f7; font-family: ${FONT}; }
  .mark::before { content: "●"; margin-right: 5px; font-size: 8px; vertical-align: 1px; }
  .panel { display: grid; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); font: 13px/18px ${FONT}; }
  .tones, .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { padding: 3px 10px; border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; color: #c4c7ce; font-size: 12.5px; line-height: 16px; transition: border-color 150ms ease, color 150ms ease; }
  .chip:hover { color: #f1f3f7; }
  .chip[aria-pressed="true"] { border-color: #f1f3f7; color: #f1f3f7; }
  .chip[disabled], .draft[disabled], .send[disabled] { opacity: 0.5; cursor: default; }
  .drafts { margin: 0; padding: 0; list-style: none; border-top: 1px solid rgba(255,255,255,0.08); }
  .drafts li { border-bottom: 1px solid rgba(255,255,255,0.08); }
  .draft { display: flex; gap: 10px; width: 100%; padding: 6px 0; color: #868a93; text-align: left; box-sizing: border-box; }
  .draft:hover, .draft[aria-pressed="true"] { color: #f1f3f7; }
  .draft .n { font: 12px/18px ${MONO}; }
  .text { all: unset; display: block; box-sizing: border-box; width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; color: #f1f3f7; font: 13.5px/19px ${FONT}; white-space: pre-wrap; }
  .text:focus { border-color: rgba(255,255,255,0.4); }
  .send { padding: 4px 12px; border-radius: 999px; background: #f1f3f7; color: #000; font-weight: 500; transition: transform 160ms ease; }
  .send:active { transform: scale(0.97); }
  .send b { margin-left: 8px; font: 400 11px/16px ${MONO}; opacity: 0.6; }
  .err { margin: 0; color: #f87171; font-size: 12px; }
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
  return { host, root, body };
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
  marks: new Map<string, ReadonlyArray<Mark>>(),
  enabled: true,
  killed: false,
  strips: new Map<
    string,
    { host: HTMLElement; root: ShadowRoot; body: HTMLElement; html: string }
  >(),
  /** Open reply panels by post id; absent means closed. */
  panels: new Map<string, ReplyPanel>(),
  saves: new Map<string, OverlaySave["state"]>(),
  chips: [] as Array<{ host: HTMLElement; body: HTMLElement; toolbar: HTMLElement }>,
};

const stripHtml = (postId: string, p: OverlayPost): string => {
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
  for (const m of state.marks.get(postId) ?? [])
    cells.push(`<span class="mark">${markText(m)}</span>`);
  const open = state.panels.has(postId);
  const saved =
    state.saves.get(postId) ??
    (state.marks.get(postId)?.some((mark) => mark.kind === "saved") ? "saved" : undefined);
  const saveLabel =
    saved === "saving"
      ? "Saving"
      : saved === "saved"
        ? "Saved"
        : saved === "failed"
          ? "Save failed, try again"
          : "Save";
  return `${cells.join("")}<span class="act"><button data-act="save"${saved === "saving" || saved === "saved" ? " disabled" : ""}>${saveLabel}</button><button data-act="reply" aria-expanded="${open}">${open ? "Close" : "Reply"}</button></span>`;
};

const ago = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60
    ? `${m}m ago`
    : m < 1_440
      ? `${Math.round(m / 60)}h ago`
      : `${Math.round(m / 1_440)}d ago`;
};
/** Same words as the tool rows: "replied 1h ago", "saved", "lead · warm", "watching", "auto · rule". */
const markText = (m: Mark): string =>
  m.kind === "replied"
    ? `replied ${m.at === null ? "" : ago(m.at)}`.trim()
    : m.kind === "lead"
      ? `lead · ${m.detail}`
      : m.kind === "auto"
        ? `auto · ${m.detail}`
        : m.kind;

/** The panel element under a strip's row, drawn from its state; removed when closed. */
const renderPanel = (postId: string) => {
  const strip = state.strips.get(postId);
  if (strip === undefined) return;
  const panel = state.panels.get(postId);
  let el = strip.root.querySelector<HTMLElement>(".panel");
  if (panel === undefined) {
    el?.remove();
    return;
  }
  if (el === null) {
    el = document.createElement("div");
    el.className = "panel";
    strip.body.after(el);
  }
  // The textarea keeps what the user typed across redraws: only state changes redraw it.
  el.innerHTML = panelHtml(panel);
};

const setPanel = (postId: string, change: Partial<ReplyPanel> | null) => {
  if (change === null) state.panels.delete(postId);
  else state.panels.set(postId, { ...(state.panels.get(postId) ?? emptyPanel), ...change });
  renderPanel(postId);
  const strip = state.strips.get(postId);
  const post = state.posts.get(postId);
  if (strip !== undefined && post !== undefined) render(strip, stripHtml(postId, post));
};

const mountStrip = (article: HTMLElement, postId: string, post: OverlayPost) => {
  const row = articleActionRow(article);
  if (row === null) return;
  const { host, root, body } = shadowHost("strip");
  host.setAttribute(HOST_ATTR, postId);
  const html = stripHtml(postId, post);
  body.innerHTML = html;
  // Listeners sit inside the closed root: outside it every target reads as the host. Typing in
  // the panel must not reach x.com's own key handling (j/k scroll, l likes).
  for (const type of ["keydown", "keyup", "keypress"])
    root.addEventListener(type, (e) => e.stopPropagation());
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const act = target.dataset.act;
    const chip = target.closest<HTMLElement>("[data-tone],[data-draft],[data-send],[data-cancel]");
    if (act === undefined && chip === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (act === "save") {
      if (state.saves.get(postId) === "saving" || state.saves.get(postId) === "saved") return;
      state.saves.set(postId, "saving");
      const strip = state.strips.get(postId);
      const post = state.posts.get(postId);
      if (strip !== undefined && post !== undefined) render(strip, stripHtml(postId, post));
      return send({ type: "save", postId });
    }
    if (act === "reply")
      return setPanel(postId, state.panels.has(postId) ? null : { ...emptyPanel });
    if (chip === null) return;
    const panel = state.panels.get(postId) ?? emptyPanel;
    const text = () => root.querySelector("textarea")?.value ?? panel.text;
    if (chip.dataset.cancel !== undefined) return setPanel(postId, null);
    if (chip.dataset.draft !== undefined)
      return setPanel(postId, { text: panel.drafts[Number(chip.dataset.draft)] ?? panel.text });
    if (chip.dataset.send !== undefined) {
      const value = text().trim();
      if (value === "") return;
      setPanel(postId, { busy: "reply", error: null, text: value });
      return send({ type: "reply", postId, text: value });
    }
    const tone = chip.dataset.tone;
    if (tone === "") return setPanel(postId, { tone: null, drafts: [], text: text() });
    setPanel(postId, { tone: tone as ReplyTone, busy: "draft", error: null, text: text() });
    send({ type: "draft", postId, tone: tone as ReplyTone });
  });
  row.after(host);
  state.strips.set(postId, { host, root, body, html });
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
    const { host, root, body } = shadowHost("chips");
    body.innerHTML = chipsHtml();
    // Pointer-down, not click: focusing a collapsed composer makes X remount the toolbar
    // before the click would fire. preventDefault keeps X's editor from losing focus.
    const schedule = () => {
      const text = composerText(toolbar)?.innerText.trim() ?? "";
      const route = text === "" ? "/compose?new=1" : `/compose?text=${encodeURIComponent(text)}`;
      send({ type: "openRoute", route });
    };
    for (const type of ["keydown", "keyup", "keypress"])
      root.addEventListener(type, (e) => e.stopPropagation());
    body.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("[data-act]") === null) return;
      e.preventDefault();
      schedule();
    });
    // Native buttons emit detail=0 clicks for Enter, Space and assistive activation.
    // Pointer clicks already ran on pointerdown, before X could replace the toolbar.
    body.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-act]") === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 0) schedule();
    });
    post.before(host);
    state.chips.push({ host, body, toolbar });
  }
};

const renderGlance = () => {
  for (const chip of state.chips) chip.body.innerHTML = chipsHtml();
};

// Who is signed in, for observations, the service's handle and the composer; sent once per change.
let viewer = "";
const reportViewer = () => {
  const found = viewerFromNav(document);
  const key = JSON.stringify(found);
  if (found === null || key === viewer) return;
  viewer = key;
  ipcRenderer.send(OVERLAY_VIEWER_CHANNEL, found);
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
    if (strip !== undefined) render(strip, stripHtml(postId, post));
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
  const cancelDismiss = () => clearTimeout(timer);
  const dismiss = () => {
    clearTimeout(timer);
    timer = setTimeout(hide, 200);
  };
  body.addEventListener("mouseenter", cancelDismiss);
  body.addEventListener("mouseleave", dismiss);
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
    cancel: dismiss,
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
    state.saves.delete(id);
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
ipcRenderer.on(OVERLAY_MARKS_CHANNEL, (_event, marks: OverlayMarks) => {
  for (const [id, found] of Object.entries(marks)) state.marks.set(id, found);
  queueScan();
});
ipcRenderer.on(OVERLAY_SAVE_CHANNEL, (_event, status: OverlaySave) => {
  state.saves.set(status.postId, status.state);
  queueScan();
});
ipcRenderer.on(OVERLAY_REPLY_CHANNEL, (_event, outcome: OverlayReply) => {
  if (!state.panels.has(outcome.postId)) return;
  setPanel(
    outcome.postId,
    "drafts" in outcome
      ? { busy: null, drafts: outcome.drafts, text: outcome.drafts[0] ?? "" }
      : "replied" in outcome
        ? { busy: null, replied: true }
        : { busy: null, error: outcome.error },
  );
});
ipcRenderer.on(OVERLAY_GLANCE_CHANNEL, (_event, glance: Glance) => {
  state.glance = glance;
  renderGlance();
});

window.addEventListener("DOMContentLoaded", () => {
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  queueScan();
});
