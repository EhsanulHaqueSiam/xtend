import { expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../../test/render";

import { type ChatRead, readChat, watchChat, xChatInfo, xChatSearch, xChatSend } from "./chat";
import { markXReady, registerXWebview, xOverEnded, type XWebview } from "./x";

// X's chat embed as it draws (abs.twimg.com/x-web/xchat/embed, pin-page-rweb): a row's link
// holds its face, then name and time over the preview, then its muted and unread marks.
const icon = (name: string) => `<svg data-icon="${name}"></svg>`;
const row = (id: string, name: string, time: string, preview: string, marks: string, faces = 1) =>
  `<div data-testid="dm-conversation-item-${id}" data-selected="false"><a href="/i/chat/${id.replace(":", "-")}"><div data-inbox-row=""><div class="py-3">${'<img src="https://pbs.twimg.com/profile_images/1/a_200x200.jpg">'.repeat(faces)}</div><div><div><div class="min-w-0 flex-1"><span>${name}</span></div><div>${marks.includes("pin") ? icon("icon-pin") : ""}<span>${time}</span></div></div><div><div><span>${preview}</span></div><div>${marks.includes("muted") ? icon("icon-bell-off") : ""}${marks.includes("unread") ? icon("icon-circle-fill") : ""}</div></div></div></div></a></div>`;
const INBOX = `<div data-testid="dm-container"><div data-testid="dm-inbox-panel">
  <div data-testid="dm-search-bar"><input data-testid="dm-search-input"></div>
  <div data-testid="dm-conversation-scroller">
    <div data-testid="dm-message-requests-list-item"><a href="/i/chat/requests" data-testid="dm-message-requests-inbox-row"><div data-inbox-row=""><div class="py-3"></div><div><div><div><span>Message Requests</span></div></div><div><div><span>Bo and 2 others</span></div><svg data-testid="dm-message-requests-inbox-row-unread" data-icon="icon-circle-fill"></svg></div></div></div></a></div>
    ${row("11:22", "Ann", "2m", "See you at 6", "unread pin")}
    ${row("g33", "Weekend plans", "3d", "Cy: Saturday", "muted", 2)}
  </div></div></div>`;
const message = (id: string, mine: boolean, inner: string, labels: string, info = "") =>
  `<div class="relative flex w-full px-4 ${mine ? "justify-end" : "justify-start"}" data-testid="message-${id}" data-send-status="sent"><div class="absolute inset-0 z-0" aria-hidden="true"></div>${labels}<div class="grid"><div style="grid-area: content">${inner}</div>${info === "" ? "" : `<div style="grid-area: message-info">${info}</div>`}</div></div>`;
const words = (id: string, text: string) =>
  `<div role="article"><div data-testid="message-text-${id}"><div class="relative inline-flex"><span><span>${text}</span><span aria-hidden="true">5:06 PM</span></span><div class="absolute bottom-0"><span>5:06 PM</span></div></div></div></div>`;
const CONVERSATION = `<div data-testid="dm-container"><div data-testid="dm-conversation-panel">
  <div data-testid="dm-conversation-header"><span data-testid="dm-conversation-username">Ann</span></div>
  <div data-testid="dm-message-list">
    <div data-testid="dm-informational-item-d1">Today</div>
    ${message("m1", true, words("m1", "Yes, after work"), '<span hidden id=":r1:-sender">You</span><span hidden id=":r1:-time">5:04 PM</span>')}
    ${message("m2", false, "", '<span hidden id=":r2:-sender">Ann</span><span hidden id=":r2:-kind">Photo</span>')}
    ${message(
      "m3",
      false,
      words("m3", "See you at 6"),
      '<span hidden id=":r3:-sender">Ann</span><span hidden id=":r3:-time">5:06 PM</span>',
      "<div><button><div><span>👍</span></div><span>2</span></button><button><div><span>❤️</span></div></button></div>",
    )}
  </div></div></div>`;
const PIN = `<div><h1 data-testid="pin-title">Enter your passcode</h1><div data-testid="pin-code-input-container"><input><input><input><input></div></div>`;

/** X's page in this document, for one test: the chat host's open shadow root drawing `markup`. */
const drawX = (markup: string) => {
  document.body.innerHTML = `<div data-testid="xchatEmbedRoute"></div>`;
  const root = document.querySelector("div")!.attachShadow({ mode: "open" });
  root.innerHTML = markup;
  return { root, [Symbol.dispose]: () => document.body.replaceChildren() };
};

it("reads X's inbox rows, its requests row and a conversation by X's own markup", () => {
  using _inbox = drawX(INBOX);
  const inbox = readChat(document, "/i/chat");
  expect(inbox.inbox).toEqual([
    {
      id: "11:22",
      href: "/i/chat/11-22",
      name: "Ann",
      avatars: ["https://pbs.twimg.com/profile_images/1/a_200x200.jpg"],
      preview: "See you at 6",
      time: "2m",
      unread: true,
      muted: false,
      pinned: true,
      group: false,
    },
    expect.objectContaining({
      id: "g33",
      name: "Weekend plans",
      muted: true,
      unread: false,
      group: true,
    }),
  ]);
  expect(inbox.inbox?.[1]?.avatars).toHaveLength(2);
  expect([inbox.requestsRow, inbox.items, inbox.locked]).toEqual([
    { summary: "Bo and 2 others", unread: true },
    null,
    false,
  ]);

  using _open = drawX(CONVERSATION);
  const open = readChat(document, "/i/chat/11-22");
  expect([open.inbox, open.title]).toEqual([null, "Ann"]);
  expect(open.items).toEqual([
    { kind: "info", id: "d1", text: "Today" },
    {
      kind: "message",
      id: "m1",
      mine: true,
      sender: "You",
      text: "Yes, after work",
      time: "5:04 PM",
      media: null,
      reactions: [],
      status: "sent",
    },
    expect.objectContaining({ id: "m2", mine: false, text: "", time: null, media: "Photo" }),
    expect.objectContaining({
      id: "m3",
      text: "See you at 6",
      reactions: [
        { emoji: "👍", count: 2 },
        { emoji: "❤️", count: 1 },
      ],
    }),
  ]);
});

it("reads X's send marks, whether X draws its composer, and a request X asks the user to accept", () => {
  const panel = (inner: string) =>
    `<div data-testid="dm-container"><div data-testid="dm-conversation-panel"><div data-testid="dm-message-list">${inner}</div>`;
  const composer = `<div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea></div></div></div>`;
  using _open = drawX(
    panel(
      message("m1", true, words("m1", "On my way"), "").replace("sent", "pending") +
        message("m2", true, words("m2", "Running late"), "").replace("sent", "failed"),
    ) + composer,
  );
  const open = readChat(document, "/i/chat/11-22");
  expect([open.items?.map((i) => i.kind === "message" && i.status), open.composer]).toEqual([
    ["pending", "failed"],
    true,
  ]);
  // A conversation just started: X draws its composer before any message.
  using _empty = drawX(panel("") + composer);
  expect(readChat(document, "/i/chat/11-33").items).toEqual([]);

  using _request = drawX(
    panel(message("m3", false, words("m3", "Hi"), "")) +
      `<div data-testid="dm-message-request-prompt"><div data-testid="dm-message-request-description">Accept message requests from <a href="https://x.com/bo">@bo</a></div><button data-testid="dm-message-request-accept-button">Accept</button></div></div></div>`,
  );
  expect(readChat(document, "/i/chat/requests/11-44")).toMatchObject({
    composer: false,
    request: "Accept message requests from @bo",
  });
});

it("reads X's passcode screen as locked, with nothing else", () => {
  using _pin = drawX(PIN);
  expect(readChat(document, "/i/chat")).toMatchObject({
    locked: true,
    inbox: null,
    requests: null,
    items: null,
    search: null,
  });
});

it("answers once X's chat redraws, from its own source in X's page, and stops when let go", async () => {
  using x = drawX(INBOX);
  // The engine's scripts run in X's page; here, in this document, as X's at /i/chat.
  registerXWebview({
    loadURL: async () => {},
    getURL: () => "https://x.com/i/chat",
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  const reads: Array<ChatRead> = [];
  const stop = new AbortController();
  watchChat(stop.signal, (read) => reads.push(read));
  await expect.poll(() => reads.length).toBe(1);
  expect(reads[0]?.inbox?.map((r) => r.name)).toEqual(["Ann", "Weekend plans"]);

  // A new message lifts a conversation: X redraws, and the watch answers with what X drew.
  x.root
    .querySelector('[data-testid="dm-conversation-scroller"]')!
    .insertAdjacentHTML("beforeend", row("11:44", "Dee", "now", "Hello", "unread"));
  await expect.poll(() => reads.length).toBe(2);
  expect(reads[1]?.inbox?.map((r) => r.name)).toEqual(["Ann", "Weekend plans", "Dee"]);
  stop.abort();
});

it("lets go of X's page when stopped: its watch disconnects and clears its timers, reading no more", async () => {
  using x = drawX(INBOX);
  using _timers = fakeTimers();
  registerXWebview({
    loadURL: async () => {},
    getURL: () => "https://x.com/i/chat",
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  const reads: Array<ChatRead> = [];
  const stop = new AbortController();
  watchChat(stop.signal, (read) => reads.push(read));
  await vi.waitFor(() => expect(reads).toHaveLength(1));
  // X's page now waits for its next redraw, with its cap.
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));

  stop.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect([disconnect.mock.calls.length, vi.getTimerCount()]).toEqual([1, 0]);
  x.root
    .querySelector('[data-testid="dm-conversation-scroller"]')!
    .insertAdjacentHTML("beforeend", row("11:44", "Dee", "now", "Hello", "unread"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect([reads.length, disconnect.mock.calls.length]).toEqual([1, 1]);
});

it("types only into X's own Chat page, never its drawer, and closes only the query it typed while X holds it", async () => {
  using x = drawX(INBOX);
  // X's chat drawer, on X's other pages, has a search of its own.
  const drawer = document.createElement("div");
  drawer.dataset.testid = "xchatEmbedDrawer";
  document.body.append(drawer);
  const drawerRoot = drawer.attachShadow({ mode: "open" });
  drawerRoot.innerHTML = `<input data-testid="dm-search-input">`;
  x.root
    .querySelector('[data-testid="dm-search-bar"]')!
    .insertAdjacentHTML("beforeend", '<button data-testid="dm-search-close"></button>');
  const field = (root: ShadowRoot) =>
    root.querySelector<HTMLInputElement>('[data-testid="dm-search-input"]')!;
  let closes = 0;
  x.root
    .querySelector('[data-testid="dm-search-close"]')!
    .addEventListener("click", () => closes++);
  // The engine's scripts run here, as X's page at `path`.
  let path = "/home";
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${path}`,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(`return ${code.replaceAll("location.pathname", JSON.stringify(path))}`)(),
      ),
  } as unknown as XWebview);
  markXReady();

  await xChatSearch("Ann");
  expect([field(x.root).value, field(drawerRoot).value]).toEqual(["", ""]);
  path = "/i/chat";
  await xChatSearch("Ann");
  expect([field(x.root).value, field(drawerRoot).value]).toEqual(["Ann", ""]);
  // The user typed over it in X: that query is theirs, so Xtend leaves it open.
  field(x.root).value = "Bob";
  await xChatSearch("");
  expect(closes).toBe(0);
  await xChatSearch("Cy");
  await xChatSearch("");
  expect(closes).toBe(1);
  // Waiting for X to draw its field when the user leaves Chat: the screen's close ends the wait,
  // so the field X draws later is never typed into.
  const input = field(x.root);
  input.value = "";
  input.remove();
  const waiting = xChatSearch("Dee", true);
  await xChatSearch("");
  x.root.querySelector('[data-testid="dm-search-bar"]')!.prepend(input);
  expect([await waiting, input.value]).toEqual([false, ""]);
});

/** The engine on X's page in this document, at a path the test moves as X's router would. */
const engineAt = (path: string) => {
  Reflect.set(window, "__xPath", path);
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${String(Reflect.get(window, "__xPath"))}`,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(`return ${code.replaceAll("location.pathname", "window.__xPath")}`)(),
      ),
  } as unknown as XWebview);
  markXReady();
};
/** X's open conversation, drawn into `root`: the user's messages `ids`, then X's composer and Send. */
const conversationIn = (root: ShadowRoot, ids: ReadonlyArray<string>, greyed = false) => {
  root.innerHTML = `<div data-testid="dm-container"><div data-testid="dm-conversation-panel"><div data-testid="dm-message-list">${ids.map((id) => message(id, true, words(id, `Text ${id}`), "")).join("")}</div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea><button data-testid="dm-composer-send-button"${greyed ? " disabled" : ""}>Send</button></div></div></div>`;
  return {
    field: root.querySelector("textarea")!,
    send: root.querySelector<HTMLButtonElement>('[data-testid="dm-composer-send-button"]')!,
    /** Adds a message of the user's as X does, marked `status`. */
    add: (id: string, text: string, status = "sent", at: InsertPosition = "beforeend") =>
      root
        .querySelector('[data-testid="dm-message-list"]')!
        .insertAdjacentHTML(
          at,
          message(id, true, words(id, text), "").replace('"sent"', `"${status}"`),
        ),
  };
};

it("presses nothing once X shows another conversation than the one the user wrote in", async () => {
  using x = drawX("");
  engineAt("/i/chat/11-22");
  const presses: Array<string> = [];
  // X keeps its Send greyed a moment; meanwhile the user opens Bo's chat.
  let ann = conversationIn(x.root, ["m1"], true);
  const moved = xChatSend("/i/chat/11-22", "On my way", ["m1"]);
  await vi.waitFor(() => expect(ann.field.value).toBe("On my way"));
  Reflect.set(window, "__xPath", "/i/chat/11-33");
  conversationIn(x.root, ["b1"]).send.addEventListener("click", () => presses.push("send"));
  expect(await moved).toBeNull();

  // At the same path, X draws another conversation's messages and composer.
  Reflect.set(window, "__xPath", "/i/chat/11-22");
  ann = conversationIn(x.root, ["m1"], true);
  const redrawn = xChatSend("/i/chat/11-22", "On my way", ["m1"]);
  await vi.waitFor(() => expect(ann.field.value).toBe("On my way"));
  conversationIn(x.root, ["b1"]).send.addEventListener("click", () => presses.push("send"));
  expect(await redrawn).toBeNull();
  expect(presses).toEqual([]);
});

it("takes its own typing back when X's Send never comes, and leaves whatever X's composer holds alone", async () => {
  using x = drawX("");
  using _timers = fakeTimers();
  engineAt("/i/chat/11-22");
  const ann = conversationIn(x.root, ["m1"], true);
  const greyed = xChatSend("/i/chat/11-22", "On my way", ["m1"]);
  await vi.advanceTimersByTimeAsync(3_000);
  expect([await greyed, ann.field.value]).toEqual([null, ""]);
  // The same words typed in X afterwards are the user's own there, and so is a reply X holds.
  ann.field.value = "On my way";
  expect(await xChatSend("/i/chat/11-22", "On my way", ["m1"])).toEqual({
    status: "draft",
    id: null,
  });
  expect(ann.field.value).toBe("On my way");
  ann.field.value = "";
  ann.field.insertAdjacentHTML(
    "beforebegin",
    '<div data-testid="dm-composer-reply-bar"><button aria-label="Cancel reply"></button></div>',
  );
  expect(await xChatSend("/i/chat/11-22", "On my way", ["m1"])).toEqual({
    status: "draft",
    id: null,
  });
  expect(x.root.querySelector('[data-testid="dm-composer-reply-bar"]')).not.toBeNull();
});

it("pins its own message: not an older one X mounts meanwhile, and an edit only once X shows its new text sent", async () => {
  using x = drawX("");
  using _timers = fakeTimers();
  engineAt("/i/chat/11-22");
  const ann = conversationIn(x.root, ["m1"]);
  ann.send.addEventListener(
    "click",
    () => {
      // X mounts an older message of the user's as its list settles, then adds the new one, sending.
      ann.add("o1", "Earlier", "sent", "afterbegin");
      ann.add("n1", ann.field.value, "pending");
      ann.field.value = "";
    },
    { once: true },
  );
  const sending = xChatSend("/i/chat/11-22", "Running late", ["m1"]);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await sending).toEqual({ status: "pending", id: "n1" });

  // X's Edit on m1: its hover bar, its "..." and its Edit row put X's composer in edit mode.
  const editMode =
    '<div data-testid="dm-composer-edit-mode"><button data-testid="dm-composer-discard-edit-button"></button></div>';
  x.root.addEventListener("mouseover", () => {
    if (!x.root.querySelector('[data-testid="message-overflow-button-m1"]'))
      x.root
        .querySelector('[data-testid="message-m1"] [role="article"]')!
        .insertAdjacentHTML(
          "beforeend",
          '<button data-testid="message-overflow-button-m1"></button>',
        );
  });
  x.root.addEventListener("click", (event) => {
    const el = event.target as Element;
    if (el.matches('[data-testid="message-overflow-button-m1"]'))
      x.root.append(
        Object.assign(document.createElement("div"), {
          role: "menu",
          innerHTML:
            '<div role="menuitem"><svg data-icon="icon-pencil-stroke"></svg>Edit message</div>',
        }),
      );
    if (el.closest('[role="menuitem"]')) {
      x.root.querySelector('[role="menu"]')!.remove();
      ann.field.insertAdjacentHTML("beforebegin", editMode);
      ann.field.value = "Text m1";
    }
  });
  const text = () => x.root.querySelector('[data-testid="message-text-m1"] span span')!;
  // X's Save leaves edit mode at once, before X shows the new text: that is no answer yet.
  const save = (shows: boolean) =>
    ann.send.addEventListener(
      "click",
      () => {
        x.root.querySelector('[data-testid="dm-composer-edit-mode"]')!.remove();
        if (shows) setTimeout(() => (text().textContent = ann.field.value), 500);
      },
      { once: true },
    );
  save(false);
  const unanswered = xChatSend("/i/chat/11-22", "Yes, after six", ["m1"], { edit: "m1" });
  await vi.advanceTimersByTimeAsync(20_000);
  expect([await unanswered, text().textContent]).toEqual([
    { status: "pending", id: "m1" },
    "Text m1",
  ]);
  ann.field.value = "";
  save(true);
  const edited = xChatSend("/i/chat/11-22", "Yes, after six", ["m1"], { edit: "m1" });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await edited).toEqual({ status: "sent", id: "m1" });
});

it("lets X's page about a conversation go when the user moves on, and says they finished there only once X is back", async () => {
  using x = drawX(
    `<div data-testid="dm-container"><button data-testid="dm-conversation-more-button">More</button></div>`,
  );
  engineAt("/i/chat/11-22");
  // X's More opens X's page about the conversation.
  x.root
    .querySelector("button")!
    .addEventListener("click", () => Reflect.set(window, "__xPath", "/i/chat/11-22/info"));
  const shown: Array<boolean> = [];
  const left = xChatInfo("/i/chat/11-22", (s) => shown.push(s));
  await vi.waitFor(() => expect(shown).toEqual([true]));
  // The user goes to another screen while X's page is up.
  xOverEnded();
  expect(await left).toBe(false);

  Reflect.set(window, "__xPath", "/i/chat/11-22");
  const finished = xChatInfo("/i/chat/11-22", (s) => shown.push(s));
  await vi.waitFor(() => expect(shown).toEqual([true, true]));
  // X's Back, in X's page.
  Reflect.set(window, "__xPath", "/i/chat/11-22");
  expect(await finished).toBe(true);
  expect(shown).toEqual([true, true, false]);
});
