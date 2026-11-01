import type { MockState } from "./state.ts";
import { esc } from "./pages.ts";

/**
 * Mock x.com's one HTML document: X's shell (nav, primary column, the layers X draws menus,
 * dialogs and toasts in) and the script that makes it behave like X's app. Routing is X's:
 * `history.pushState` plus `popstate` changes the page without a reload, and a page this document
 * already showed comes back from its cache with no new GraphQL request. A full load starts empty.
 */

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #000; color: #e7e9ea; font: 15px/1.35 system-ui, sans-serif; }
a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; background: none; border: 1px solid #333; border-radius: 999px; padding: 2px 10px; cursor: pointer; }
header[role="banner"] { position: fixed; left: 0; top: 0; bottom: 0; width: 72px; border-right: 1px solid #2f3336; display: flex; flex-direction: column; gap: 12px; padding: 8px; }
main { margin-left: 72px; }
[data-testid="primaryColumn"] { max-width: 600px; border-right: 1px solid #2f3336; min-height: 100vh; }
.bar { display: flex; gap: 8px; align-items: center; padding: 8px 12px; }
.bar h2 { margin: 0; font-size: 20px; }
.tabs { display: flex; border-bottom: 1px solid #2f3336; }
.tabs [role="tab"] { flex: 1; text-align: center; padding: 12px 4px; color: #71767b; cursor: pointer; }
.tabs [aria-selected="true"] { color: #e7e9ea; font-weight: 700; box-shadow: inset 0 -3px #1d9bf0; }
article, .user, [data-testid="trend"], [data-testid="listCell"] { display: block; min-height: 120px; padding: 12px; border-bottom: 1px solid #2f3336; }
.row, .head, .profile-row { display: flex; gap: 10px; justify-content: space-between; }
.body { flex: 1; min-width: 0; }
.avatar { width: 40px; height: 40px; border-radius: 50%; }
.actions { display: flex; justify-content: space-between; margin-top: 8px; }
.actions button, .actions a { border: 0; color: #71767b; }
[data-testid="tweetPhoto"] img { max-width: 100%; border-radius: 12px; margin-top: 8px; }
.quote, .note, [data-testid="card.wrapper"], [data-testid="cardPoll"] { border: 1px solid #2f3336; border-radius: 12px; padding: 8px; margin-top: 8px; display: block; }
[role="radio"] { border: 1px solid #1d9bf0; border-radius: 999px; padding: 4px 10px; margin: 4px 0; cursor: pointer; }
.muted { color: #71767b; }
.sort { display: flex; justify-content: space-between; margin-top: 8px; }
.composer { padding: 12px; border-bottom: 1px solid #2f3336; }
[contenteditable] { min-height: 24px; outline: none; }
[contenteditable]:empty::before { content: attr(data-placeholder); color: #71767b; }
.banner-img { width: 100%; height: 120px; object-fit: cover; }
.empty { padding: 32px; }
#layers .mask { position: fixed; inset: 0; }
#layers [role="menu"] { position: fixed; background: #000; box-shadow: 0 0 12px #fff3; border-radius: 12px; min-width: 260px; }
#layers [role="menuitem"] { padding: 12px 16px; cursor: pointer; }
#layers [role="menuitem"]:hover { background: #16181c; }
.dialog { position: fixed; inset: 10% 20%; background: #000; border: 1px solid #333; border-radius: 16px; padding: 16px; overflow: auto; }
.dialog.route { inset: 5% 10%; }
.backdrop { position: fixed; inset: 0; background: #5b708366; }
[data-testid="toast"] { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1d9bf0; color: #fff; padding: 12px 16px; border-radius: 6px; display: flex; gap: 12px; }
`;

// The page script, as plain browser JavaScript: it runs in the x.com webview, which loads it from
// mock X like any of X's own scripts.
const SCRIPT = String.raw`
(() => {
  const column = document.querySelector('[data-testid="primaryColumn"]');
  const layers = document.getElementById("layers");
  const cache = new Map();
  let shown = null;
  let token = 0;
  let booted = false;
  let loadingMore = false;
  const here = () => location.pathname + location.search;
  const homeTab = () => localStorage.getItem("mockx:home-tab") || "forYou";
  const cacheKey = (path) => (path === "/home" ? path + "|" + homeTab() : path);
  const json = (r) => r.json();
  const post = (path, body) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
  const log = (name, target) => post("/__mock/press", { name, target: target ?? null, path: here() }).catch(() => {});
  const fragment = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    const div = document.createElement("div");
    div.append(t.content);
    return div;
  };

  /** Fires the page's GraphQL calls as X's app makes them, so the capture sees each answer. */
  const graphql = (r) =>
    fetch(r.url, r.body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: r.body }).then(json);

  async function load(path, cursor) {
    const q = new URLSearchParams({ path, tab: homeTab() });
    if (cursor) q.set("cursor", cursor);
    if (!booted) q.set("boot", "1");
    booted = true;
    const view = await fetch("/__mock/view?" + q).then(json);
    await Promise.all(view.graphql.map(graphql));
    return view;
  }

  async function show() {
    const path = here();
    const key = cacheKey(path);
    const mine = ++token;
    closeLayers();
    let entry = cache.get(key);
    if (!entry) {
      const view = await load(path);
      if (mine !== token) return;
      entry = { el: fragment(view.html), next: view.next, title: view.title, path, scroll: 0 };
      cache.set(key, entry);
    }
    if (mine !== token) return;
    if (shown && shown !== entry) {
      shown.scroll = scrollY;
      shown.el.remove();
    }
    column.append(entry.el);
    shown = entry;
    document.title = entry.title;
    scrollTo(0, entry.scroll);
  }

  /** X's next page once the user (or the engine) scrolls to the end of the list. */
  async function more() {
    const entry = shown;
    if (!entry || !entry.next || loadingMore) return;
    if (innerHeight + scrollY < document.documentElement.scrollHeight - 300) return;
    loadingMore = true;
    try {
      const view = await load(entry.path, entry.next);
      entry.el.querySelector("[data-list]")?.append(...fragment(view.html).childNodes);
      entry.next = view.next;
    } finally {
      loadingMore = false;
    }
  }
  addEventListener("scroll", () => void more(), { passive: true });
  addEventListener("popstate", () => void show());

  const go = (path, replace) => {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    void show();
  };

  function closeLayers() {
    layers.replaceChildren();
  }

  function toast(spec) {
    for (const old of document.querySelectorAll('[data-testid="toast"]')) old.remove();
    const el = document.createElement("div");
    el.dataset.testid = "toast";
    el.setAttribute("role", "alert");
    const text = document.createElement("span");
    text.textContent = spec.text;
    el.append(text);
    if (spec.undo) {
      const undo = document.createElement("button");
      undo.setAttribute("role", "button");
      undo.textContent = "Undo";
      undo.addEventListener("click", () => {
        log("toast:Undo");
        el.remove();
        void run(spec.undo);
      });
      el.append(undo);
    }
    if (spec.action) {
      const action = document.createElement("button");
      action.textContent = spec.action;
      el.append(action);
    }
    document.body.append(el);
    setTimeout(() => el.remove(), 6000);
  }

  function dialog(spec) {
    closeLayers();
    const wrap = document.createElement("div");
    wrap.innerHTML = '<div class="backdrop"></div>';
    const box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", spec.sheet ? "alertdialog" : "dialog");
    box.setAttribute("aria-modal", "true");
    if (spec.sheet) box.dataset.testid = "confirmationSheetDialog";
    const title = document.createElement("h2");
    title.textContent = spec.title;
    const body = document.createElement("p");
    body.textContent = spec.body;
    const closeButton = document.createElement("button");
    closeButton.dataset.testid = "app-bar-close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "✕";
    closeButton.addEventListener("click", closeLayers);
    box.append(closeButton, title, body);
    for (const b of spec.buttons) {
      const button = document.createElement("button");
      button.textContent = b.label;
      if (b.testid) button.dataset.testid = b.testid;
      button.addEventListener("click", () => {
        log("dialog:" + b.label);
        closeLayers();
        if (b.step) void run(b.step);
      });
      box.append(button);
    }
    wrap.firstElementChild.addEventListener("click", closeLayers);
    wrap.append(box);
    layers.append(wrap);
  }

  function turnFollow(userId, on) {
    const from = on ? "-follow" : "-unfollow";
    for (const b of document.querySelectorAll('[data-testid="' + userId + from + '"]')) {
      b.dataset.testid = userId + (on ? "-unfollow" : "-follow");
      b.textContent = on ? "Following" : "Follow";
    }
  }

  async function run(step) {
    if (step.write) await post(step.write.path, step.write.body);
    if (step.follow) turnFollow(step.follow.userId, step.follow.on);
    if (step.toast) toast(step.toast);
    if (step.dialog) dialog(step.dialog);
    if (step.go) go(step.go, false);
    if (step.replace) go(step.replace, true);
  }

  /** X's dropdown under the trigger: a mask beside the menu closes it, as on x.com. */
  async function openMenu(trigger, spec, rows) {
    log("menu:" + spec);
    rows = rows ?? (await fetch("/__mock/menu?spec=" + encodeURIComponent(spec)).then(json));
    closeLayers();
    const at = trigger.getBoundingClientRect();
    const wrap = document.createElement("div");
    const mask = document.createElement("div");
    mask.className = "mask";
    mask.addEventListener("click", () => {
      log("menu:closed");
      closeLayers();
    });
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.style.top = Math.min(at.bottom, innerHeight - 40 * rows.length - 16) + "px";
    menu.style.left = Math.max(8, Math.min(at.left, innerWidth - 280)) + "px";
    const list = document.createElement("div");
    list.dataset.testid = "Dropdown";
    for (const row of rows) {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;
      if (row.testid) item.dataset.testid = row.testid;
      item.textContent = row.label;
      item.addEventListener("click", async () => {
        log("row:" + row.label, spec);
        closeLayers();
        await run(row);
        if (row.testid === "retweetConfirm" || row.testid === "unretweetConfirm") turnRepost(trigger, row.testid === "retweetConfirm");
      });
      list.append(item);
    }
    menu.append(list);
    wrap.append(mask, menu);
    layers.append(wrap);
  }

  const counts = (button, by) => {
    const n = button.querySelector("[data-count]");
    if (n && /^\d+$/.test(n.textContent)) n.textContent = String(Math.max(0, Number(n.textContent) + by));
  };
  /** X turns the pressed button at once, on every copy of the post the page draws. */
  function turn(id, from, to, by) {
    for (const b of document.querySelectorAll('[data-testid="' + from + '"][data-post="' + id + '"]')) {
      b.dataset.testid = to;
      counts(b, by);
    }
  }
  function turnRepost(trigger, on) {
    turn(trigger.dataset.post, on ? "retweet" : "unretweet", on ? "unretweet" : "retweet", on ? 1 : -1);
  }

  const BUTTONS = {
    like: ["unlike", 1, "FavoriteTweet"],
    unlike: ["like", -1, "UnfavoriteTweet"],
    bookmark: ["removeBookmark", 1, "CreateBookmark"],
    removeBookmark: ["bookmark", -1, "DeleteBookmark"],
  };
  const TOASTS = {
    like: { text: "Keep it up! The more posts you like, the better your timeline will be." },
    bookmark: { text: "Added to your Bookmarks", action: "Add to Folder" },
    removeBookmark: { text: "Removed from your Bookmarks" },
  };
  let likedOnce = false;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    // Menus and dialogs handle their own clicks; the path is taken at dispatch, so a close button
    // that removed its layer still counts as inside it.
    if (!target || event.composedPath().includes(layers)) return;
    const el = target.closest("[data-testid], [data-menu], [data-home-tab], [data-vote], [data-bell], [data-subscribe], [data-href], a[href], [data-toggle-translation]");
    if (!el) return;
    const testid = el.dataset.testid ?? "";
    const id = el.dataset.post;

    if (el.dataset.homeTab !== undefined) {
      event.preventDefault();
      log("tab:" + el.dataset.homeTab);
      localStorage.setItem("mockx:home-tab", el.dataset.homeTab);
      void show();
      return;
    }
    if (testid === "retweet" || testid === "unretweet") {
      log(testid, id);
      void openMenu(el, "retweet:" + id);
      return;
    }
    if (el.dataset.menu !== undefined) {
      log(testid || "menu", el.dataset.menu);
      void openMenu(el, el.dataset.menu);
      return;
    }
    if (BUTTONS[testid] && id) {
      const [to, by, op] = BUTTONS[testid];
      log(testid, id);
      turn(id, testid, to, by);
      void post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables: { tweet_id: id } });
      if (testid !== "like" || !likedOnce) toast(TOASTS[testid] ?? { text: "" });
      if (testid === "like") likedOnce = true;
      return;
    }
    const follow = /^(\d+)-(follow|unfollow|subscribe)$/.exec(testid);
    if (follow) {
      const [, userId, what] = follow;
      log(testid, userId);
      if (what === "follow") {
        turnFollow(userId, true);
        void post("/i/api/1.1/friendships/create.json", { user_id: userId });
      } else if (what === "unfollow") void fetch("/__mock/dialog?spec=" + encodeURIComponent("unfollow:" + userId)).then(json).then(dialog);
      else void fetch("/__mock/dialog?spec=" + encodeURIComponent("subscribe:" + userId)).then(json).then(dialog);
      return;
    }
    if (el.dataset.subscribe !== undefined) {
      log("subscribe", el.dataset.subscribe);
      void fetch("/__mock/dialog?spec=" + encodeURIComponent("subscribe:" + el.dataset.subscribe)).then(json).then(dialog);
      return;
    }
    if (el.dataset.bell !== undefined) {
      const on = el.getAttribute("aria-label").startsWith("Turn on");
      log("bell", el.dataset.bell);
      el.setAttribute("aria-label", on ? "Turn off post notifications" : "Turn on post notifications");
      void post("/i/api/1.1/friendships/update.json", { id: el.dataset.bell, device: String(on) });
      return;
    }
    if (el.dataset.vote !== undefined) {
      const [postId, choice] = el.dataset.vote.split(":");
      log("vote", postId);
      const poll = el.closest('[data-testid="cardPoll"]');
      void post("/i/api/1.1/capi/vote.json", { tweet_id: postId, choice }).then(() =>
        fetch("/__mock/poll?id=" + postId).then((r) => r.text()).then((html) => { poll.outerHTML = html; }),
      );
      el.closest('[role="radiogroup"]')?.remove();
      return;
    }
    if (el.dataset.toggleTranslation !== undefined) {
      el.textContent = el.textContent === "Show original" ? "Show translation" : "Show original";
      el.setAttribute("aria-label", el.textContent);
      return;
    }
    if (testid === "app-bar-back" || testid === "app-bar-close") {
      log(testid);
      history.back();
      return;
    }
    if (testid === "reply") {
      log("reply", id);
      go("/compose/post?in_reply_to=" + id, false);
      return;
    }
    if (testid === "tweetButton") {
      const box = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]');
      const text = box?.textContent ?? "";
      log("tweetButton");
      if (text.trim() !== "") void post("/i/api/graphql/" + window.__mockHash.CreateTweet + "/CreateTweet", { variables: { tweet_text: text } }).then(() => history.back());
      return;
    }
    const href = el.getAttribute("href") ?? el.dataset.href;
    if (href && href.startsWith("/") && !el.hasAttribute("target")) {
      event.preventDefault();
      go(href, false);
    }
  });

  void show();
})();
`;

/** The document every x.com path answers with; the script draws the route it is on. */
export function shell(state: MockState, hashes: Readonly<Record<string, string>>) {
  const v = state.viewer;
  return `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><title>X</title><style>${CSS}</style></head>
<body><div id="react-root">
<header role="banner"><nav aria-label="Primary" role="navigation">
  <a href="/home" data-testid="AppTabBar_Home_Link" aria-label="Home">⌂</a>
  <a href="/explore" data-testid="AppTabBar_Explore_Link" aria-label="Search and explore">⌕</a>
  <a href="/notifications" data-testid="AppTabBar_Notifications_Link" aria-label="Notifications">🔔</a>
  <a href="/i/connect_people" aria-label="Follow">＋</a>
  <a href="/messages" data-testid="AppTabBar_DirectMessage_Link" aria-label="Chat">✉</a>
  <a href="/i/bookmarks" aria-label="Bookmarks">🔖</a>
  <a href="/${esc(v.handle)}/lists" aria-label="Lists">☰</a>
  <a href="/${esc(v.handle)}" data-testid="AppTabBar_Profile_Link" aria-label="Profile">👤</a>
  <a href="/compose/post" data-testid="SideNav_NewTweet_Button" aria-label="Post">✎</a>
</nav>
<button data-testid="SideNav_AccountSwitcher_Button" aria-label="Account menu"><img alt="${esc(v.name ?? v.handle)}" src="${esc(v.avatarUrl ?? "")}" class="avatar"></button>
</header>
<main role="main"><div data-testid="primaryColumn"></div></main>
<div id="layers"></div>
</div>
<script>window.__mockHash = ${JSON.stringify(hashes)};</script>
<script src="/__mock/client.js"></script>
</body></html>`;
}

export const clientScript = () => SCRIPT;
