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
/* X's queue rows are tall enough that a page of them scrolls, as X's do. */
[data-testid="UserCell"], [data-case] { display: block; min-height: 640px; border-bottom: 1px solid #2f3336; }
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
  // Pages that switch tabs in place, on one URL: Home's timelines, a Community search's orders,
  // a game's tabs.
  const inPage = (path) => {
    const p = path.split("?")[0];
    if (p === "/i/jf/creators/inspiration/top_posts") return "inspiration";
    if (p === "/i/account_analytics" || p.startsWith("/i/account_analytics/")) return "analytics";
    return p === "/home" ? "home" : /^\/i\/communities\/\d+\/search$/.test(p) ? "communitySearch" : /^\/i\/nba\/game\/\d+$/.test(p) ? "game" : null;
  };
  const pageTab = (path) => {
    const kind = inPage(path);
    if (kind === "inspiration") return localStorage.getItem("mockx:tab:inspiration") || "Likes:Daily";
    if (kind === "analytics") return localStorage.getItem("mockx:tab:analytics:" + path.split("?")[0]) || "7D";
    return kind === null ? "" : localStorage.getItem("mockx:tab:" + kind) || (kind === "home" ? "forYou" : kind === "game" ? "Top" : "Likes");
  };
  const cacheKey = (path) => (inPage(path) === null ? path : path + "|" + pageTab(path));
  const json = (r) => r.json();
  const post = (path, body) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
  const log = (name, target) => post("/__mock/press", { name, target: target ?? null, path: here() }).catch(() => {});
  const fragment = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html;
    const div = document.createElement("div");
    div.append(t.content);
    // X's chat draws in open shadow roots on its host divs: a template marks each one.
    for (const shadow of div.querySelectorAll("template[data-shadow]")) {
      const root = shadow.parentElement.attachShadow({ mode: "open" });
      root.append(shadow.content);
      shadow.remove();
      chatRoot(root);
    }
    // X draws a List's row anchorless (loader.ListHandler): its List is only the link in the
    // props of the cell React rendered, here a fiber of that shape; the markup's data-href is mock X's.
    for (const cell of div.querySelectorAll('[data-testid="listCell"]'))
      cell.__reactFiber$mockx = { stateNode: cell, memoizedProps: { role: "link" }, return: { memoizedProps: { link: { pathname: cell.dataset.href, anchorless: true }, testID: "listCell" }, return: { stateNode: cell.parentElement, memoizedProps: {}, return: null } } };
    return div;
  };

  // X's Chat, in its shadow root (its events stay inside it): the passcode screen opens the chats
  // once four digits are typed, search lists X's matches in place, and X's links open in X's router.
  function chatRoot(root) {
    const pins = () => [...root.querySelectorAll('[data-testid="pin-code-input-container"] input')];
    // X draws its results in place of the inbox list while a query is typed, and the list again after.
    const list = root.querySelector('[data-testid="dm-conversation-scroller"]');
    const options = root.querySelector("template[data-mock-search]");
    const results = document.createElement("div");
    results.setAttribute("role", "listbox");
    const search = (q) => {
      if (!list || !options) return;
      if (q === "") return void results.replaceWith(list);
      results.replaceChildren(...[...options.content.children].filter((o) => o.dataset.name.toLowerCase().includes(q)).map((o) => o.cloneNode(true)));
      if (list.isConnected) list.replaceWith(results);
    };
    root.addEventListener("input", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement)) return;
      if (pins().includes(field)) {
        if (pins().every((p) => /^\d$/.test(p.value)))
          void post("/__mock/chat-unlock", {}).then(() => { log("chat:passcode"); cache.clear(); void show(); });
        return;
      }
      if (field.dataset.testid === "dm-search-input") search(field.value.trim().toLowerCase());
    });
    root.addEventListener("click", (event) => {
      const el = event.target instanceof Element ? event.target : null;
      if (el?.closest('[data-testid="dm-search-close"]')) {
        log("chat:search-close");
        const input = root.querySelector('[data-testid="dm-search-input"]');
        if (input) input.value = "";
        return search("");
      }
      const a = el?.closest("a[href]");
      if (a) {
        event.preventDefault();
        log("chat:" + a.getAttribute("href"));
        go(a.getAttribute("href"), false);
      }
    });
    chatControls(root);
  }

  // X's controls in a conversation (pin-page-rweb): a message's hover bar once the pointer is over
  // it, its "..." menu and reaction picker, X's confirm, and the composer. What they change goes to
  // mock X, and the page draws anew, as X's store answers.
  function chatControls(root) {
    const conversation = root.querySelector("[data-mock-conversation]")?.dataset.mockConversation;
    const field = root.querySelector('[data-testid="dm-composer-textarea"]');
    let replyTo = null;
    let editing = null;
    const write = (body) => post("/__mock/chat", { conversation, ...body }).then(() => cache.clear());
    const messageOf = (id) => root.querySelector('[data-testid="message-' + CSS.escape(id) + '"]');
    const clone = (message, name) => message.querySelector("template[data-mock-" + name + "]").content.firstElementChild.cloneNode(true);
    const closePopups = () => {
      for (const popup of root.querySelectorAll("[data-mock-popup]")) popup.remove();
      for (const b of root.querySelectorAll('[aria-expanded="true"]')) b.setAttribute("aria-expanded", "false");
    };
    const popup = (el, id) => {
      el.dataset.mockPopup = id ?? "";
      root.append(el);
    };
    const dialog = (title, body, buttons) => {
      const box = document.createElement("div");
      box.setAttribute("role", "dialog");
      const h = document.createElement("h2");
      h.textContent = title;
      const p = document.createElement("p");
      p.textContent = body;
      box.append(h, p);
      for (const [label, step] of buttons) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", () => { box.remove(); log("chat:" + label); step?.(); });
        box.append(b);
      }
      closePopups();
      popup(box);
    };
    // X's Send takes the voice button's place once there is text, and reads Save while editing.
    const swapSend = () => {
      const now = root.querySelector('[data-testid="dm-composer-send-button"], [data-testid="dm-composer-voice-button"]');
      const send = field.value.trim() !== "" || editing !== null;
      const label = !send ? "Record voice message" : editing !== null ? "Save" : "Send";
      if (!now || now.getAttribute("aria-label") === label) return;
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.testid = send ? "dm-composer-send-button" : "dm-composer-voice-button";
      b.setAttribute("aria-label", label);
      b.textContent = send ? "➤" : "🎤";
      now.replaceWith(b);
    };
    const bar = (testid, html) => {
      for (const old of root.querySelectorAll('[data-testid="dm-composer-reply-bar"], [data-testid="dm-composer-edit-mode"]')) old.remove();
      const el = document.createElement("div");
      el.dataset.testid = testid;
      el.innerHTML = html;
      root.querySelector('[data-testid="dm-composer-container"]').prepend(el);
      return el;
    };
    const reply = (message) => {
      editing = null;
      replyTo = message.dataset.testid.slice("message-".length);
      bar("dm-composer-reply-bar", '<b></b><button type="button" aria-label="Cancel reply">✕</button>').firstChild.textContent =
        message.querySelector('span[hidden][id$="-sender"]')?.textContent ?? "";
      swapSend();
    };
    root.addEventListener("mouseover", (event) => {
      const message = event.target instanceof Element ? event.target.closest('[data-testid^="message-"][data-send-status]') : null;
      const bubble = message?.querySelector('[role="group"], [role="article"]');
      if (!bubble || bubble.querySelector(".hover-bar") || !message.querySelector("template[data-mock-hover]")) return;
      for (const old of root.querySelectorAll(".hover-bar")) old.remove();
      bubble.append(clone(message, "hover"));
    });
    root.addEventListener("input", (event) => {
      if (field && event.target === field) swapSend();
    });
    root.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest('button, [role="menuitem"]') : null;
      if (!button) return;
      const testid = button.dataset.testid ?? "";
      const message = button.closest('[data-testid^="message-"][data-send-status]');
      const opener = /^message-(overflow|reaction)-button-(.+)$/.exec(testid);
      if (opener) {
        const open = button.getAttribute("aria-expanded") === "true";
        closePopups();
        if (open) return;
        button.setAttribute("aria-expanded", "true");
        return popup(clone(message, opener[1] === "overflow" ? "menu" : "reactions"), opener[2]);
      }
      if (testid.startsWith("message-reply-button-")) return reply(message);
      const shown = button.closest("[data-mock-popup]");
      const id = shown?.dataset.mockPopup;
      if (shown && id && button.hasAttribute("aria-pressed")) {
        closePopups();
        log("chat:react");
        return void write({ kind: "react", message: id, emoji: button.getAttribute("aria-label") }).then(show);
      }
      if (shown && id && button.getAttribute("role") === "menuitem") {
        const label = button.textContent.trim();
        const name = button.querySelector("svg")?.dataset.icon;
        const text = shown.dataset.mockText ?? "";
        closePopups();
        log("chat:" + label);
        if (name === "icon-reply-arrow") return reply(messageOf(id));
        if (name === "icon-pencil-stroke") {
          replyTo = null;
          editing = id;
          bar("dm-composer-edit-mode", '<span>Edit message</span><button type="button" aria-label="Discard edit" data-testid="dm-composer-discard-edit-button">✕</button>');
          field.value = text;
          return swapSend();
        }
        if (name === "icon-trashcan-stroke")
          return dialog("Delete message", "Are you sure you want to delete this message?", [["Cancel"], [label, () => void write({ kind: "delete", message: id }).then(show)]]);
        if (name === "icon-forward-stroke") return dialog("Forward", "", [["Close"]]);
        if (name === "icon-information-circle") return dialog("Message info", "", [["Close"]]);
        return;
      }
      if (testid === "dm-composer-send-button") {
        log("chat:send");
        const body = editing !== null ? { kind: "edit", message: editing, text: field.value } : { kind: "send", text: field.value, ...(replyTo === null ? {} : { replyTo }) };
        return void write(body).then(show);
      }
      if (button.getAttribute("aria-label") === "Cancel reply") {
        replyTo = null;
        return button.parentElement.remove();
      }
      if (testid === "dm-composer-discard-edit-button") {
        editing = null;
        field.value = "";
        button.parentElement.remove();
        return swapSend();
      }
      if (testid === "dm-message-request-accept-button") {
        log("chat:accept");
        return void write({ kind: "accept" }).then(show);
      }
      if (testid === "dm-message-request-delete-button")
        return dialog("Delete conversation?", "Are you sure you want to delete this conversation? This action cannot be undone.", [["Cancel"], ["Delete", () => void write({ kind: "decline" }).then(() => go("/i/chat/requests", true))]]);
      if (testid === "dm-conversation-more-button") {
        log("chat:info");
        go(location.pathname + "/info", false);
      }
    });
  }

  /** Fires the page's GraphQL calls as X's app makes them, so the capture sees each answer. */
  const graphql = (r) =>
    fetch(r.url, r.body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: r.body }).then(json);

  async function load(path, cursor) {
    // X draws some pages (its settings) by the window's width: wide, or its compact layout.
    const q = new URLSearchParams({ path, tab: pageTab(path), width: String(innerWidth) });
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
    // X's Radar asks afresh each time its page shows (network-only), so it is never cached.
    if (path.startsWith("/i/radar")) cache.delete(key);
    // So do X's Articles pages: the editor and the lists read the Article afresh.
    if (path.startsWith("/compose/articles")) cache.delete(key);
    let entry = cache.get(key);
    if (!entry) {
      const view = await load(path);
      if (mine !== token) return;
      // X's Redirect: the path it sends this one to replaces it.
      if (view.redirect) {
        history.replaceState(null, "", view.redirect);
        return void show();
      }
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
    drawTrends();
  }

  // X unmounts cells far from its scroll. Keep their slots so the page's height stays stable.
  function drawTrends() {
    if (!shown) return;
    shown.trends ??= [...shown.el.querySelectorAll('[data-trend-slot]')].map((slot) => ({ slot, cell: slot.firstElementChild }));
    for (const { slot, cell } of shown.trends) {
      const rect = slot.getBoundingClientRect();
      if (slot.dataset.dismissed !== "true" && rect.bottom >= -innerHeight / 2 && rect.top <= innerHeight * 1.5) {
        if (!cell.isConnected) slot.append(cell);
      } else cell.remove();
    }
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
  addEventListener("scroll", () => { drawTrends(); void more(); }, { passive: true });

  // X's GIF search runs what is typed in place, on its own route: its list starts over per query,
  // and each query searched is a history entry, so Back returns to the query before it.
  const GIF_PATH = "/i/foundmedia/search";
  let gifQuery = 0;
  async function searchGifs(entry, query) {
    const mine = ++gifQuery;
    const path = GIF_PATH + "?q=" + encodeURIComponent(query);
    const view = await load(path);
    if (mine !== gifQuery) return;
    const list = fragment(view.html).querySelector("[data-list]");
    entry.el.querySelector("[data-list]")?.replaceChildren(...(list ? [...list.childNodes] : []));
    entry.path = path;
    entry.next = view.next;
  }
  let typed = 0;
  document.addEventListener("input", (event) => {
    const field = event.target;
    const entry = shown;
    if (!(field instanceof HTMLInputElement) || field.placeholder !== "Search for GIFs" || !entry) return;
    const mine = ++typed;
    setTimeout(() => {
      if (mine !== typed) return;
      history.pushState({ gifQuery: field.value }, "", location.pathname);
      void searchGifs(entry, field.value);
    }, 300);
  });
  addEventListener("popstate", () => {
    const field = document.querySelector('input[placeholder="Search for GIFs"]');
    if (location.pathname !== GIF_PATH || !field || !shown) return;
    field.value = history.state?.gifQuery ?? "";
    void searchGifs(shown, field.value);
  });
  addEventListener("popstate", () => void show());

  const go = (path, replace) => {
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    void show();
  };

  function closeLayers() {
    for (const caret of document.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]'))
      caret.setAttribute("aria-expanded", "false");
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

  function turnJoin(id, label) {
    for (const b of document.querySelectorAll('[data-community-join="' + id + '"]')) {
      b.setAttribute("aria-label", label + b.getAttribute("aria-label").replace(/^(Join|Ask to join|Joined|Requested)/, ""));
      b.textContent = label;
    }
  }

  const removedTrends = new Map();
  async function run(step) {
    if (step.trend) {
      const { name, hidden } = step.trend;
      await post("/__mock/trend", { name, hidden, path: here() });
      if (hidden) {
        const el = [...document.querySelectorAll('[data-testid="trend"]')].find((t) => t.dataset.trend === name);
        if (el) {
          removedTrends.set(name, { el, parent: el.parentElement, next: el.nextSibling, height: el.parentElement.style.height });
          el.parentElement.dataset.dismissed = "true";
          el.parentElement.style.height = "0px";
          el.remove();
        }
      } else {
        const saved = removedTrends.get(name);
        if (saved) {
          delete saved.parent.dataset.dismissed;
          saved.parent.style.height = saved.height;
          saved.parent.insertBefore(saved.el, saved.next?.parentNode === saved.parent ? saved.next : null);
          removedTrends.delete(name);
        }
      }
    }
    if (step.write) await post(step.write.path, step.write.body);
    if (step.remove) document.querySelector(step.remove)?.remove();
    if (step.follow) turnFollow(step.follow.userId, step.follow.on);
    if (step.community) turnJoin(step.community.id, step.community.label);
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
    trigger.setAttribute("aria-expanded", "true");
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
    const el = target.closest("[data-testid], [data-menu], [data-home-tab], [data-vote], [data-bell], [data-subscribe], [data-community-join], [data-community-pin], [data-href], a[href], [data-toggle-translation]");
    if (!el) return;
    const testid = el.dataset.testid ?? "";
    const id = el.dataset.post;

    if (el.dataset.homeTab !== undefined) {
      event.preventDefault();
      log("tab:" + el.dataset.homeTab);
      localStorage.setItem("mockx:tab:" + inPage(here()), el.dataset.homeTab);
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
    if (el.dataset.communityJoin !== undefined) {
      const id = el.dataset.communityJoin;
      const label = el.textContent.trim();
      log("communityJoin:" + label, id);
      // An open Community joins at once; one that asks first shows its rules, and leaving asks to confirm.
      if (label === "Join") {
        turnJoin(id, "Joined");
        void post("/i/api/graphql/" + window.__mockHash.JoinCommunity + "/JoinCommunity", { variables: { communityId: id } });
      } else if (label === "Ask to join" || label === "Joined")
        void fetch("/__mock/dialog?spec=" + encodeURIComponent((label === "Joined" ? "leave:" : "join:") + id)).then(json).then(dialog);
      return;
    }
    if (el.dataset.communityPin !== undefined) {
      const id = el.dataset.communityPin;
      const pin = el.getAttribute("aria-label") === "Pin Community";
      log("communityPin:" + (pin ? "Pin" : "Unpin"), id);
      el.setAttribute("aria-label", pin ? "Unpin Community from Home screen" : "Pin Community");
      const op = pin ? "PinTimeline" : "UnpinTimeline";
      void post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables: { communityId: id } });
      toast({ text: pin ? "Pinned to your Home timeline" : "Unpinned from your Home timeline" });
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
    if (testid === "gifSearchButton") {
      log(testid);
      go("/i/foundmedia/search", false);
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
      // X sends a post with bold or italic as a long post, its runs as richtext_tags.
      const tags = [];
      let at = 0;
      for (const node of box?.childNodes ?? []) {
        const types = node instanceof HTMLElement ? [node.style.fontWeight === "700" && "Bold", node.style.fontStyle === "italic" && "Italic"].filter(Boolean) : [];
        const length = node.textContent.length;
        if (types.length > 0) tags.push({ from_index: at, to_index: at + length, richtext_types: types });
        at += length;
      }
      const op = tags.length > 0 ? "CreateNoteTweet" : "CreateTweet";
      // A Community audience rides the post as X's composer sends it, with its share toggle.
      const to = audience === null ? {} : {
        conversation_control: { mode: "Community" },
        semantic_annotation_ids: [{ entity_id: audience.id, group_id: "8", domain_id: "31" }],
        broadcast: document.querySelector("[data-share] input")?.checked === true,
      };
      audience = null;
      const variables = { tweet_text: text, ...to, ...(tags.length > 0 ? { richtext_options: { richtext_tags: tags } } : {}) };
      if (text.trim() !== "") void post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables }).then(() => history.back());
      return;
    }
    const href = el.getAttribute("href") ?? el.dataset.href;
    if (href && href.startsWith("/") && !el.hasAttribute("target")) {
      event.preventDefault();
      go(href, false);
    }
  });

  // X's audience card in its composer: opening it asks X for the user's Communities, and a row
  // sets the audience (a composer setting; Post sends it). Escape closes it, picking nothing.
  let audience = null;
  const setAudience = (button, community) => {
    audience = community === null ? null : { id: community.id_str, name: community.name };
    button.querySelector("span").textContent = community === null ? "Everyone" : community.name;
    document.querySelector("[data-share]")?.remove();
    log("audience:" + (community === null ? "Everyone" : community.name));
    if (community === null) return;
    const share = document.createElement("label");
    share.dataset.share = "";
    share.style.display = "block";
    share.innerHTML = '<input type="checkbox">';
    share.append("Also share with followers");
    button.after(share);
  };
  document.addEventListener("click", async (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[aria-label="Choose audience"]') : null;
    if (!button) return;
    log("audience");
    const body = await fetch("/i/api/graphql/" + window.__mockHash.CommunitiesMembershipsSlice + "/CommunitiesMembershipsSlice?variables=%7B%7D").then(json);
    const mine = (body.data?.viewer?.user_results?.result?.community_memberships_slice?.items_results ?? []).map((r) => r.result);
    closeLayers();
    const card = document.createElement("div");
    card.dataset.testid = "HoverCard";
    card.setAttribute("role", "group");
    // Over the composer, as X draws its cards in its layers.
    card.style.cssText = "position: fixed; top: 15%; left: 30%; z-index: 10; background: #000; border: 1px solid #333; padding: 8px";
    const heading = (text, tag) => { const h = document.createElement(tag); h.textContent = text; card.append(h); };
    const row = (parts, community) => {
      const item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.tabIndex = 0;
      for (const part of parts) { const span = document.createElement("span"); span.textContent = part; item.append(span); }
      item.addEventListener("click", () => { closeLayers(); setAudience(button, community); });
      card.append(item);
    };
    heading("Choose audience", "h2");
    row(["Everyone"], null);
    if (mine.length > 0) heading("My Communities", "h3");
    for (const c of mine) row([c.name, ...(c.member_count === undefined ? [] : [c.member_count + " Members"])], c);
    layers.append(card);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && layers.querySelector('[data-testid="HoverCard"]')) closeLayers();
  });

  // X's composer (Draft.js): for an account X lets format, its command key (⌘ on a Mac, Ctrl
  // elsewhere) with B or I toggles the style of what is typed next, drawn as a styled leaf; for
  // any other the keys do nothing. Once it styles, it types at the end itself.
  const typing = { Bold: false, Italic: false };
  const textBox = (event) => (event.target instanceof Element ? event.target.closest('[data-testid="tweetTextarea_0"]') : null);
  document.addEventListener("keydown", (event) => {
    const command = /Mac OS X/.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
    const style = command ? { b: "Bold", i: "Italic" }[event.key] : undefined;
    if (!textBox(event) || !style || !window.__mockFormats) return;
    event.preventDefault();
    typing[style] = !typing[style];
    log("composer:" + style + (typing[style] ? " on" : " off"));
  });
  document.addEventListener("beforeinput", (event) => {
    const box = textBox(event);
    if (!box || typeof event.data !== "string" || event.data === "") return;
    const plain = !typing.Bold && !typing.Italic;
    if (plain && box.querySelector("[data-offset-key]") === null) return;
    event.preventDefault();
    if (plain) return void box.append(event.data);
    const leaf = document.createElement("span");
    leaf.dataset.offsetKey = "leaf";
    if (typing.Bold) leaf.style.fontWeight = "700";
    if (typing.Italic) leaf.style.fontStyle = "italic";
    leaf.textContent = event.data;
    box.append(leaf);
  });

  // X's Creator Studio (Jetfuel) buttons act on a pointer's whole press, as on x.com: a bare
  // click() does nothing. Filters shown before come back from the page cache, sending nothing.
  const jfPress = { down: null, up: null };
  const jfAt = (event) => (event.isPrimary && event.pointerType === "mouse" && event.target instanceof Element ? event.target.closest("[data-jf]") : null);
  addEventListener("pointerdown", (event) => { jfPress.down = jfAt(event); }, true);
  addEventListener("pointerup", (event) => { jfPress.up = jfAt(event); }, true);
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-jf]") : null;
    const pressed = el !== null && jfPress.down === el && jfPress.up === el;
    jfPress.down = jfPress.up = null;
    if (!pressed) return;
    const [filter, id] = el.dataset.jf.split(":");
    if (filter === "language") return;
    log("jf:" + el.textContent.trim());
    const [engagement, period] = pageTab(here()).split(":");
    localStorage.setItem("mockx:tab:inspiration", filter === "period" ? engagement + ":" + id : id + ":" + period);
    void show();
  });

  // X's analytics range buttons answer a click; a range shown before comes back from the page
  // cache, sending nothing, as X's Relay store serves it.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-range]") : null;
    if (el === null) return;
    log("range:" + el.dataset.range);
    localStorage.setItem("mockx:tab:analytics:" + location.pathname, el.dataset.range);
    void show();
  });
  // X's bookmark folder dialogs on their own routes (Create, Edit, Add to Folder): each button
  // sends X's call as X's page does, then X leaves the route. Delete Folder asks first.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-folder]") : null;
    if (!el) return;
    const [action, folderId, tweetId] = el.dataset.folder.split(":");
    const name = document.querySelector('[role="dialog"] input[name="name"]')?.value.trim() ?? "";
    const send = (op, variables) => post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables });
    log("folder:" + action, folderId ?? null);
    if (action === "create" && name) void send("createBookmarkFolder", { name }).then(() => history.back());
    if (action === "save" && name)
      void send("EditBookmarkFolder", { bookmark_collection_id: folderId, name }).then(() => history.back());
    if (action === "put" || action === "pull")
      void send(action === "put" ? "bookmarkTweetToFolder" : "RemoveTweetFromBookmarkFolder", {
        bookmark_collection_id: folderId,
        tweet_id: tweetId,
      }).then(() => {
        toast({ text: (action === "put" ? "Saved to " : "Removed from ") + el.dataset.folderName });
        history.back();
      });
    if (action === "delete")
      dialog({
        title: "Delete Folder?",
        body: 'Your posts will still be saved in the "All Bookmarks" folder',
        sheet: true,
        buttons: [
          {
            label: "Delete",
            testid: "confirmationSheetConfirm",
            step: {
              write: { path: "/i/api/graphql/" + window.__mockHash.DeleteBookmarkFolder + "/DeleteBookmarkFolder", body: { variables: { bookmark_collection_id: folderId } } },
              toast: { text: "Folder has been deleted" },
              replace: "/i/bookmarks",
            },
          },
          { label: "Cancel", testid: "confirmationSheetCancel" },
        ],
      });
  });
  // X's Hide post: the rule picked, X hides the post and goes back to where it was.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-hide-rule]") : null;
    if (!el) return;
    const postId = location.pathname.split("/").pop();
    log("hide:" + el.dataset.hideRule, postId);
    cache.clear();
    void post("/__mock/moderate", { kind: "hide", postId }).then(() => history.back());
  });
  // X's Ban: the rule picked, X removes the author and goes back.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-ban-rule]") : null;
    if (!el) return;
    log("ban:" + el.dataset.banRule, location.pathname.split("/").pop());
    cache.clear();
    void post("/__mock/moderate", { kind: "ban", postId: el.dataset.post }).then(() => history.back());
  });
  // X's queues: Approve, Deny and Keep send X's call, and X draws its decision in the row's place.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-x-request], [data-x-case]") : null;
    if (!el) return;
    event.stopPropagation();
    const communityId = location.pathname.split("/")[3];
    const send = (op, variables) => post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables });
    const [action, id] = (el.dataset.xRequest ?? el.dataset.xCase).split(":");
    log(action, id);
    const row = el.closest("[data-testid=UserCell], [data-case]");
    const handle = row.querySelector("a[href]")?.getAttribute("href").slice(1);
    if (action === "keep")
      void send("CommunityModerationKeepTweet", { tweetId: id }).then(() => {
        row.outerHTML = '<div aria-label="You kept this post">You kept this post</div>';
      });
    else
      void send(action === "approve" ? "actions_approveMemberRequest_Mutation" : "actions_denyMemberRequest_Mutation", { communityId, userId: id }).then(() => {
        row.outerHTML = action === "approve" ? "<div>@" + handle + " was approved and is now a member of your Community</div>" : "<div>@" + handle + " was denied and can’t join your Community</div>";
      });
  }, true);
  // X's Community admin pages (bundle.Communities). A form's Save sends X's call with its fields
  // and goes back (Create opens the new Community under X's summary); Adult Content saves at the
  // press and X loads its page again; Leave moderation team and Delete Community ask first. A
  // checklist row marks itself done in X's page and opens its step; Got it closes X's summary.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-x-save], [data-x-check], [data-x-confirm], [data-x-step], [data-x-got-it]") : null;
    if (!el) return;
    event.stopPropagation();
    const send = (op, variables) => post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables });
    const communityId = location.pathname.split("/")[3];
    if (el.dataset.xSave !== undefined) {
      const op = el.dataset.xSave;
      const fields = {};
      for (const f of el.closest("[data-x-form]").querySelectorAll("[name]"))
        if (f.type !== "radio" || f.checked) fields[f.name] = f.value.trim();
      log("save:" + op, communityId ?? null);
      cache.clear();
      if (op === "CreateCommunity")
        void send(op, fields).then((r) => go("/i/communities/" + r.data.community_create_v2.rest_id + "?show_creation_summary", true));
      else void send(op, { communityId, ...fields }).then(() => history.back());
      return;
    }
    if (el.dataset.xCheck !== undefined) {
      log("check:" + el.dataset.xCheck, communityId);
      void send(el.dataset.xCheck, { communityId, adultContentSetting: el.checked }).then(() => location.reload());
      return;
    }
    if (el.dataset.xConfirm === "leave")
      return dialog({
        title: "Are you sure you want to leave the mod team?",
        body: "You’ll no longer have access to the moderation tools. If you change your mind, you’ll have to be invited as a moderator again.",
        sheet: true,
        buttons: [
          { label: "Yes, I want to leave", testid: "confirmationSheetConfirm", step: { write: { path: "/i/api/graphql/" + window.__mockHash.CommunityUpdateRole + "/CommunityUpdateRole", body: { variables: { communityId, role: "Member" } } }, replace: "/i/communities/" + communityId } },
          { label: "Cancel", testid: "confirmationSheetCancel" },
        ],
      });
    if (el.dataset.xConfirm === "delete")
      return dialog({
        title: "Delete Community",
        body: "This can’t be undone. Post authors can still see their own posts.",
        buttons: [
          { label: "Delete Community", testid: "confirmationSheetConfirm", step: { write: { path: "/i/api/graphql/" + window.__mockHash.DeleteCommunityMutation + "/DeleteCommunityMutation", body: { variables: { id: communityId } } }, replace: "/i/communities/" + communityId } },
          { label: "Cancel", testid: "confirmationSheetCancel" },
        ],
      });
    if (el.dataset.xStep !== undefined) {
      const [flag, ...to] = el.dataset.xStep.split(":");
      log("checklist:" + flag, communityId);
      cache.clear();
      void post("/__mock/checklist", { communityId, flag }).then(() => (flag === "dismiss" ? void show() : go(to.join(":"), false)));
      return;
    }
    if (el.dataset.xGotIt !== undefined) {
      log("Got it", communityId);
      // X's Got it replaces the address with the Community's own, its summary gone.
      el.closest("[data-x-summary]").remove();
      history.replaceState(null, "", location.pathname + "/");
    }
  }, true);
  // X's List buttons and dialogs (bundle.UserLists). Follow in a List's header and Pin in a row of
  // Your Lists turn once X answered. Create's Next goes on to Add to your List, whose Done opens
  // the new List; Edit List's Done goes back to it; Delete List asks first, then opens the user's
  // Lists page. X's store shows what each did, so the mock drops its cached pages.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-list-follow], [data-list-pin], [data-list-form]") : null;
    if (!el) return;
    event.stopPropagation();
    const send = (op, variables) => post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables });
    if (el.dataset.listFollow !== undefined) {
      const listId = el.dataset.listFollow;
      const follow = el.textContent.trim() === "Follow";
      log("listFollow:" + (follow ? "Follow" : "Unfollow"), listId);
      void send(follow ? "ListSubscribe" : "ListUnsubscribe", { listId }).then(() => { el.textContent = follow ? "Following" : "Follow"; });
      return;
    }
    if (el.dataset.listPin !== undefined) {
      const id = el.dataset.listPin;
      const pin = el.getAttribute("aria-label") === "Pin List";
      log("listPin:" + (pin ? "Pin" : "Unpin"), id);
      void send(pin ? "PinTimeline" : "UnpinTimeline", { pinnedTimelineItem: { id, pinned_timeline_type: "List" } })
        .then(() => el.setAttribute("aria-label", pin ? "Unpin List" : "Pin List"));
      return;
    }
    const [action, listId] = el.dataset.listForm.split(":");
    const field = (name) => document.querySelector('[role="dialog"] [name="' + name + '"]');
    const form = { name: field("name")?.value.trim() ?? "", description: field("description")?.value ?? "", isPrivate: field("isPrivate")?.checked === true };
    log("list:" + action, listId ?? null);
    cache.clear();
    if (action === "create" && form.name)
      void send("CreateList", form).then((r) => go("/i/lists/" + r.data.list.id_str + "/members/suggested", true));
    if (action === "done") go("/i/lists/" + listId, true);
    if (action === "save" && form.name) void send("UpdateList", { listId, ...form }).then(() => history.back());
    if (action === "delete")
      dialog({
        title: "Delete List?",
        body: "This can’t be undone and you’ll lose your List.",
        sheet: true,
        buttons: [
          {
            label: "Delete",
            testid: "confirmationSheetConfirm",
            step: {
              write: { path: "/i/api/graphql/" + window.__mockHash.DeleteList + "/DeleteList", body: { variables: { listId } } },
              replace: document.querySelector('nav a[aria-label="Lists"]').getAttribute("href") + "/",
            },
          },
          { label: "Cancel", testid: "confirmationSheetCancel" },
        ],
      });
  }, true);
  // X's Edit profile: a picture picked waits for Save, which sends it by its upload's media id
  // beside the text fields' call, and X goes back once that one answers, as bundle.SettingsProfile.
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-testid="editProfileButton"], [data-testid="Profile_Save_Button"], [data-pick]') : null;
    if (!el) return;
    const box = el.closest('[role="dialog"]');
    if (el.dataset.testid === "editProfileButton") return log("editProfileButton");
    if (el.dataset.pick) return void (box.dataset[el.dataset.pick] = el.dataset.pick === "avatar" ? "1950000000000000001" : "1950000000000000002");
    log("Profile_Save_Button");
    const value = (name) => box.querySelector('[name="' + name + '"]').value;
    if (box.dataset.avatar) void post("/i/api/1.1/account/update_profile_image.json", { media_id: box.dataset.avatar, return_user: true });
    if (box.dataset.banner) void post("/i/api/1.1/account/update_profile_banner.json", { media_id: box.dataset.banner, return_user: true });
    void post("/i/api/1.1/account/update_profile.json", { name: value("displayName"), description: value("description"), location: value("location"), url: value("url") }).then(() => history.back());
  });
  // X's Radar: its form's Submit turns on once its field has text, sends X's create call and opens
  // the query's page; a row opens its query, and its Delete asks in X's dialog, after which X takes
  // the row off its list without asking for the list again.
  document.addEventListener("input", (event) => {
    const form = event.target instanceof HTMLInputElement ? event.target.closest("[data-radar-form]") : null;
    if (form) form.querySelector("[data-radar-submit]").disabled = event.target.value.trim() === "";
  });
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-radar-submit], [data-radar-delete], [data-radar-row]") : null;
    if (!el) return;
    event.stopPropagation();
    if (el.dataset.radarSubmit !== undefined) {
      const query = el.closest("[data-radar-form]").querySelector("input").value.trim();
      log("radar:Submit");
      void post("/i/api/graphql/" + window.__mockHash.createInsightInputMutation + "/createInsightInputMutation", { variables: { advanced_query: query, notifications_enabled: false, title: "" } })
        .then((r) => go("/i/radar/" + r.data.create_insight_rule_v2.result.rest_id, false));
    } else if (el.dataset.radarDelete !== undefined) {
      const id = el.dataset.radarDelete;
      log("radar:Delete", id);
      dialog({
        title: "Delete '" + el.closest("[data-radar-row]").dataset.radarName + "'",
        body: "Are you sure you want to delete this query?",
        buttons: [
          { label: "Cancel" },
          { label: "Delete", step: { write: { path: "/i/api/graphql/" + window.__mockHash.deleteInsightButtonMutation + "/deleteInsightButtonMutation", body: { variables: { id } } }, remove: '[data-radar-row="' + id + '"]' } },
        ],
      });
    } else go("/i/radar/" + el.dataset.radarRow, false);
  }, true);

  // X's Grok (bundle.GrokXWeb): its History panel and model menu open from X's own buttons into
  // X's layers, its composer swaps Voice for Send once there is text, and its row controls swap in
  // X's own Rename field and Delete confirm. What they change goes to mock X, and the page draws
  // anew in place (its open panel too), as X's store answers; an answer streams, then completes.
  const grokTemplate = (name) => shown.el.querySelector("template[data-mock-grok-" + name + "]").content.firstElementChild.cloneNode(true);
  const grokConversation = () => document.querySelector("fieldset[data-grok-composer]")?.dataset.mockConversation || null;
  const grokPanel = () => layers.querySelector("[data-mock-grok-panel]");
  async function grokRedraw() {
    const entry = shown;
    if (!entry || !location.pathname.startsWith("/i/grok")) return;
    cache.clear();
    const view = await load(here());
    entry.el.replaceChildren(...fragment(view.html).childNodes);
    entry.path = here();
    cache.set(cacheKey(here()), entry);
    const panel = grokPanel();
    if (panel) {
      panel.replaceChildren(...grokTemplate("history").childNodes);
      entry.el.querySelector('[data-mock-grok="history"]')?.setAttribute("aria-expanded", "true");
    }
    if (entry.el.querySelector('[data-mock-grok="stop"]'))
      setTimeout(() => {
        const turn = [...entry.el.querySelectorAll("[data-mock-turn]")].at(-1)?.dataset.mockTurn;
        if (turn && shown === entry && entry.el.querySelector('[data-mock-grok="stop"]')) void grokWrite({ kind: "finish", turn });
      }, 400);
  }
  async function grokWrite(body) {
    const answer = await post("/__mock/grok", { conversation: grokConversation(), ...body });
    // A new chat's first send: X puts its conversation in the URL.
    if (answer.conversation && !grokConversation() && location.pathname === "/i/grok")
      history.replaceState(null, "", "/i/grok?conversation=" + encodeURIComponent(answer.conversation));
    await grokRedraw();
  }
  const grokButton = (kind, label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mockGrok = kind;
    b.setAttribute("aria-label", label);
    b.innerHTML = kind === "voice" ? '<svg data-icon="icon-voice"></svg>' : "<svg></svg>";
    return b;
  };
  document.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLTextAreaElement && field.closest("fieldset[data-grok-composer]")) {
      const now = field.closest("fieldset").querySelector('[data-mock-grok="voice"], [data-mock-grok="send"]');
      const want = field.value.trim() !== "" ? "send" : "voice";
      if (now && now.dataset.mockGrok !== want) now.replaceWith(grokButton(want, want === "send" ? "Send" : "Voice mode"));
      return;
    }
    // X's history search: only the matching rows, under their groups.
    const panel = field instanceof HTMLInputElement && field.type === "search" ? field.closest("[data-mock-grok-panel]") : null;
    if (!panel) return;
    const q = field.value.trim().toLowerCase();
    const rows = [...grokTemplate("history").querySelector("ul").children].filter((li) => q === "" || li.getAttribute("role") === "presentation" || li.textContent.toLowerCase().includes(q));
    panel.querySelector("ul").replaceChildren(...rows.filter((li, i) => li.getAttribute("role") !== "presentation" || rows[i + 1]?.hasAttribute("data-mock-row")));
  });
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest('[data-mock-grok], [data-mock-grok-model], [data-mock-grok-panel] a[href]:not([target]), [data-mock-grok-menu] a[href]') : null;
    if (!el) return;
    const kind = el.dataset.mockGrok;
    const row = el.closest("[data-mock-row]");
    const turn = el.closest("[data-mock-turn]")?.dataset.mockTurn;
    const toggle = (button, open, show) => {
      button.setAttribute("aria-expanded", String(!open));
      if (!open) layers.append(show());
    };
    // X's compact layout opens its History as a page of its own.
    if (kind === "history-page") return go("/i/grok/history", false);
    if (kind === "history") {
      const open = grokPanel();
      if (open) open.remove();
      return toggle(el, !!open, () => grokTemplate("history"));
    }
    if (kind === "models") {
      const open = layers.querySelector("[data-mock-grok-menu]");
      if (open) open.remove();
      return toggle(el, !!open, () => grokTemplate("models"));
    }
    if (el.matches("a[href]")) {
      event.preventDefault();
      event.stopPropagation();
      grokPanel()?.remove();
      layers.querySelector("[data-mock-grok-menu]")?.remove();
      log("grok:" + el.getAttribute("href"));
      return go(el.getAttribute("href"), false);
    }
    if (el.dataset.mockGrokModel) {
      layers.querySelector("[data-mock-grok-menu]")?.remove();
      document.querySelector('[data-mock-grok="models"]')?.setAttribute("aria-expanded", "false");
      log("grok:model");
      return void grokWrite({ kind: "model", title: el.dataset.mockGrokModel });
    }
    if (kind === "voice") return;
    log("grok:" + kind);
    if (kind === "private") return void grokWrite({ kind: "private" });
    if (kind === "send") return void grokWrite({ kind: "send", text: document.querySelector("fieldset[data-grok-composer] textarea").value });
    if (kind === "stop") return void grokWrite({ kind: "stop", turn: [...document.querySelectorAll("[data-mock-turn]")].at(-1)?.dataset.mockTurn });
    if (kind === "up" || kind === "down") return void grokWrite({ kind: "feedback", turn, feedback: kind });
    if (kind === "regenerate") return void grokWrite({ kind: "regenerate", turn });
    const id = row?.dataset.mockRow;
    if (!row || !id) return;
    const actions = row.querySelector(".grid, [data-mock-mode]");
    const mode = (buttons) => {
      const box = document.createElement("div");
      box.dataset.mockMode = "";
      box.append(...buttons);
      actions.replaceWith(box);
    };
    if (kind === "pin" || kind === "unpin") return void grokWrite({ kind, conversation: id });
    if (kind === "rename") {
      const link = row.querySelector("a[href]:not([target])");
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Rename");
      input.value = link.querySelector("span").textContent;
      link.replaceWith(input);
      return mode([grokButton("cancel", "Cancel"), grokButton("rename-save", "Save")]);
    }
    if (kind === "delete") return mode([grokButton("cancel", "Cancel"), grokButton("delete-confirm", "Delete")]);
    if (kind === "rename-save") return void grokWrite({ kind: "rename", conversation: id, title: row.querySelector("input").value });
    if (kind === "delete-confirm") return void grokWrite({ kind: "delete", conversation: id });
    if (kind === "cancel") return void grokRedraw();
  }, true);
  // X's Articles: its pen makes a draft and opens X's editor. The editor saves its title, and its
  // content a moment after each change (Publish stays off meanwhile); a cover goes up through X's
  // crop dialog's Apply; Publish opens X's dialog, whose Publish publishes and opens the post.
  // A step of X's editor (the crop, the Publish sheet): a dialog in X's layers, or in its compact
  // layout the whole route, X's app bar on top (Back, the title as its h2, the step's own button)
  // and the editor kept behind it.
  const closeArticleSheet = () => {
    for (const el of document.querySelectorAll("[data-article-sheet]")) el.remove();
    const root = document.querySelector("[data-mock-article]");
    if (root) root.hidden = false;
  };
  const articleSheet = (title, inner, primary) => {
    closeLayers();
    closeArticleSheet();
    const box = document.createElement("div");
    box.dataset.articleSheet = "";
    // With __mockLateSheet the step's own button comes a moment after the rest, as X may draw it.
    const late = window.__mockLateSheet && primary !== "";
    const now = late ? "" : primary;
    const later = (where) => { if (late) setTimeout(() => where.insertAdjacentHTML("beforeend", primary), 800); };
    if (window.__mockCompact) {
      box.innerHTML = '<div class="bar"><button type="button" data-testid="app-bar-back" aria-label="Back">←</button><h2>' + title + "</h2>" + now + "</div>" + inner;
      later(box.querySelector(".bar"));
      box.querySelector('[data-testid="app-bar-back"]').addEventListener("click", closeArticleSheet);
      const root = document.querySelector("[data-mock-article]");
      // With __mockReplaceOpener the editor stays on screen and its Publish is drawn anew.
      if (window.__mockReplaceOpener) {
        const opener = root.querySelector("[data-article-publish]");
        opener.replaceWith(opener.cloneNode(true));
      } else root.hidden = true;
      root.after(box);
    } else {
      box.className = "dialog";
      box.setAttribute("role", "dialog");
      box.innerHTML = "<h2>" + title + "</h2>" + inner + now;
      layers.append(box);
      later(box);
    }
  };
  const articleOp = (op, variables) => post("/i/api/graphql/" + window.__mockHash[op] + "/" + op, { variables });
  const articleId = () => document.querySelector("[data-mock-article]")?.dataset.mockArticle;
  const BLOCK_TYPES = { H1: "header-one", H2: "header-two", BLOCKQUOTE: "blockquote" };
  let saving = 0;
  const canPublish = () => {
    const root = document.querySelector("[data-mock-article]");
    const publish = root?.querySelector("[data-article-publish]");
    if (!publish) return;
    const ready = saving === 0 && root.querySelector("textarea").value.trim() !== "" && root.querySelector("[contenteditable]").textContent.trim() !== "";
    publish.disabled = !ready;
    publish.setAttribute("aria-disabled", String(!ready));
    root.querySelector("[data-save]").textContent = saving > 0 ? "Saving..." : "Saved";
  };
  const save = (op, variables) => {
    saving++;
    canPublish();
    setTimeout(() => void articleOp(op, variables).finally(() => { saving--; canPublish(); }), 400);
  };
  document.addEventListener("input", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLTextAreaElement) || !field.closest("[data-mock-article]")) return;
    save("ArticleEntityUpdateTitle", { articleEntityId: articleId(), title: field.value });
  });
  document.addEventListener("paste", (event) => {
    const box = event.target instanceof Element ? event.target.closest('[data-testid="composer"] [contenteditable]') : null;
    if (!box) return;
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    log("article:paste", html);
    // X's editor keeps the paste's blocks and styles (convertFromHTML); the mock keeps the markup.
    box.innerHTML = html;
    const blocks = [...box.querySelectorAll(":scope > *, :scope > ul > li, :scope > ol > li")]
      .filter((el) => el.tagName !== "UL" && el.tagName !== "OL")
      .map((el) => ({ type: el.tagName === "LI" ? (el.parentElement.tagName === "OL" ? "ordered-list-item" : "unordered-list-item") : BLOCK_TYPES[el.tagName] ?? "unstyled", text: el.textContent }));
    save("ArticleEntityUpdateContent", { article_entity: articleId(), content_state: { blocks, entityMap: [] } });
  }, true);
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.closest("[data-article-cover]")) return;
    log("article:cover", input.files[0]?.name ?? "");
    articleSheet("Edit media", "", '<button type="button" data-testid="applyButton" data-article-apply>Apply</button>');
  });
  document.addEventListener("click", (event) => {
    const el = event.target instanceof Element ? event.target.closest("[data-article-create], [data-article-apply], [data-article-publish], [data-article-confirm]") : null;
    if (!el) return;
    event.stopPropagation();
    const id = articleId();
    if (el.dataset.articleCreate !== undefined) {
      log("article:create");
      void articleOp("ArticleEntityDraftCreate", { content_state: { blocks: [], entityMap: [] }, title: "" })
        .then((r) => go("/compose/articles/edit/" + r.data.articleentity_create_draft.article_entity_results.result.rest_id, false));
    } else if (el.dataset.articleApply !== undefined) {
      log("article:apply");
      closeArticleSheet();
      const media = "1960000000000000001";
      saving++;
      canPublish();
      void articleOp("ArticleEntityUpdateCoverMedia", { articleEntityId: id, coverMedia: { media_id: media, media_category: "DraftTweetImage" } }).then(() => {
        document.querySelector("[data-article-cover]").innerHTML = '<img alt="" src="https://pbs.twimg.com/media/' + media + '.jpg">';
        saving--;
        canPublish();
      });
    } else if (el.dataset.articlePublish !== undefined) {
      if (el.disabled) return;
      log("article:publish");
      articleSheet(
        "Publish Article",
        '<h3>Who can reply?</h3><select data-testid="convoControl"><option value="All">Everyone</option><option value="Community">Accounts you follow</option><option value="Verified">Verified accounts</option><option value="ByInvitation">Only accounts you mention</option></select><textarea name="articleTweetText" data-testid="articleTweetTextInput" placeholder="Provide a caption (optional)"></textarea>',
        '<button type="button" data-article-confirm>Publish</button>',
      );
    } else {
      const dialog = el.closest("[data-article-sheet]");
      const mode = dialog.querySelector("select").value;
      const caption = dialog.querySelector("textarea").value.trim();
      log("article:confirm");
      void articleOp("ArticleEntityPublish", { articleEntityId: id, visibilitySetting: "Public", ...(caption === "" ? {} : { tweetText: caption }), ...(mode === "All" ? {} : { conversationControl: { mode } }) }).then((r) => {
        closeArticleSheet();
        go("/you/status/" + r.data.articleentity_publish.article_entity_results.result.metadata.tweet_results.result.rest_id, false);
      });
    }
  }, true);
  // X's settings checkboxes save each change at once, as X's page sends it (settings.ts); Protect
  // your posts stays off until X's confirm sheet's Protect.
  document.addEventListener("click", (event) => {
    const box = event.target instanceof HTMLInputElement && event.target.dataset.mockWrite ? event.target : null;
    if (!box) return;
    const at = box.dataset.mockWrite.lastIndexOf(":");
    const [path, field] = [box.dataset.mockWrite.slice(0, at), box.dataset.mockWrite.slice(at + 1)];
    const save = (on) => {
      box.checked = on;
      log("setting:" + field);
      void post(path, path.includes("/graphql/") ? { variables: { isAllowed: !on } } : { [field]: field === "universal_quality_filtering" ? (on ? "enabled" : "disabled") : on });
    };
    if (!box.checked || !box.dataset.mockConfirm) return save(box.checked);
    event.preventDefault();
    const ask = JSON.parse(box.dataset.mockConfirm);
    dialog({ sheet: true, title: ask.title, body: ask.body, buttons: [{ label: ask.yes, testid: "confirmationSheetConfirm" }, { label: "Cancel", testid: "confirmationSheetCancel" }] });
    document.querySelector('[data-testid="confirmationSheetConfirm"]').addEventListener("click", () => save(true));
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
<script>window.__mockHash = ${JSON.stringify(hashes)}; window.__mockFormats = ${String(state.formats)}; window.__mockCompact = ${String(state.compact)}; window.__mockLateSheet = ${String(state.lateSheetPublish)}; window.__mockReplaceOpener = ${String(state.replaceOpener)};</script>
<script src="/__mock/client.js"></script>
</body></html>`;
}

export const clientScript = () => SCRIPT;
