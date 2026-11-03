import type { EngineUser } from "@xtend/contracts";

/**
 * Mock X's Chat as X's chat embed (abs.twimg.com/x-web/xchat/embed) draws it: X's test ids and
 * markup in an open shadow root on `xchatEmbedRoute` (a `template[data-shadow]` the page script
 * attaches). X's chat makes no x.com GraphQL calls, so neither do these pages.
 */

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The signed-in account's id, the low or high half of each of its one-to-one conversation ids. */
const ME = "1700000000000000001";

interface MockMessage {
  readonly id: string;
  readonly mine: boolean;
  readonly sender: string;
  readonly text: string;
  readonly time: string;
  readonly media?: string;
  readonly reactions?: ReadonlyArray<{ readonly emoji: string; readonly count: number }>;
}

interface MockConversation {
  /** X's id: `<low>:<high>` user ids, or `g<id>` for a group. Its link dashes the colon. */
  readonly id: string;
  readonly name: string;
  readonly avatars: ReadonlyArray<string>;
  readonly time: string;
  readonly preview: string;
  readonly unread?: boolean;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  readonly messages: ReadonlyArray<MockMessage>;
}

const oneToOne = (u: EngineUser) =>
  BigInt(u.userId) < BigInt(ME) ? `${u.userId}:${ME}` : `${ME}:${u.userId}`;
const link = (c: MockConversation, base = "/i/chat") => `${base}/${c.id.replace(":", "-")}`;

/** What mock X's Chat holds: made-up conversations with the fixtures' people, and its lock. */
export function createMockChat(locked: boolean, people: ReadonlyArray<EngineUser>) {
  const [a, b, c, d, e, f] = people;
  if (f === undefined) throw new Error("mock chat needs six fixture people");
  const face = (u: EngineUser) => u.avatarUrl ?? "";
  const conversations: ReadonlyArray<MockConversation> = [
    {
      id: oneToOne(a!),
      name: a!.name,
      avatars: [face(a!)],
      time: "2m",
      preview: "See you at 6 then",
      unread: true,
      messages: [
        { id: "m1", mine: false, sender: a!.name, text: "Are you around later?", time: "5:02 PM" },
        { id: "m2", mine: true, sender: "You", text: "Yes, after work", time: "5:04 PM" },
        {
          id: "m3",
          mine: false,
          sender: a!.name,
          text: "",
          time: "5:05 PM",
          media: "Photo",
        },
        {
          id: "m4",
          mine: false,
          sender: a!.name,
          text: "See you at 6 then",
          time: "5:06 PM",
          reactions: [{ emoji: "👍", count: 2 }],
        },
      ],
    },
    {
      id: oneToOne(b!),
      name: b!.name,
      avatars: [face(b!)],
      time: "1h",
      preview: "You: Thanks!",
      muted: true,
      pinned: true,
      messages: [
        { id: "m5", mine: false, sender: b!.name, text: "Sent you the draft", time: "3:40 PM" },
        { id: "m6", mine: true, sender: "You", text: "Thanks!", time: "3:41 PM" },
      ],
    },
    {
      id: "g1720000000000000001",
      name: "Weekend plans",
      avatars: [face(c!), face(d!)],
      time: "3d",
      preview: `${c!.name}: Saturday works`,
      messages: [
        { id: "m7", mine: false, sender: c!.name, text: "Saturday works", time: "Oct 31" },
      ],
    },
  ];
  const requests: ReadonlyArray<MockConversation> = [
    {
      id: oneToOne(e!),
      name: e!.name,
      avatars: [face(e!)],
      time: "20s",
      preview: "Hi, quick question about your post",
      unread: true,
      messages: [
        {
          id: "m8",
          mine: false,
          sender: e!.name,
          text: "Hi, quick question about your post",
          time: "9:13 PM",
        },
      ],
    },
  ];
  const other: ReadonlyArray<MockConversation> = [
    {
      id: oneToOne(f),
      name: f.name,
      avatars: [face(f)],
      time: "4d",
      preview: "Claim your prize",
      messages: [
        { id: "m9", mine: false, sender: f.name, text: "Claim your prize", time: "Oct 30" },
      ],
    },
  ];
  let isLocked = locked;
  return {
    conversations,
    requests,
    other,
    /** Conversation pages X's page opened, in order: X marks a conversation read once it opens. */
    opened: [] as Array<string>,
    get locked() {
      return isLocked;
    },
    /** The user typed X's passcode. */
    unlock: () => {
      isLocked = false;
    },
  };
}

export type MockChat = ReturnType<typeof createMockChat>;

const icon = (name: string, testid = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" data-icon="${name}"${testid === "" ? "" : ` data-testid="${testid}"`} viewBox="0 0 24 24" width="1em" height="1em" role="img" aria-hidden="true"></svg>`;

/** X's faces: one avatar, or a group's facepile of two. */
const faces = (urls: ReadonlyArray<string>) =>
  urls.length < 2
    ? `<img src="${esc(urls[0] ?? "")}" alt="" class="avatar">`
    : `<div class="flex flex-row-reverse rounded-sm"><div class="bg-primary rounded-full"><img src="${esc(urls[0]!)}" alt="" class="avatar"></div><div><img src="${esc(urls[1]!)}" alt="" class="avatar"></div></div>`;

/** X's inbox row (pin-screen's row layout): face, then name and time over preview, then marks. */
const inboxRow = (c: MockConversation) =>
  `<div data-inbox-row="" class="mx-4 flex cursor-pointer flex-row items-stretch gap-4 rounded-md ps-2 pe-4"><div class="py-3">${faces(c.avatars)}</div><div class="flex min-w-0 flex-1 flex-col justify-center gap-1"><div class="text-body flex min-w-0 flex-row items-center justify-between gap-1.5 font-medium"><div class="min-w-0 flex-1"><span>${esc(c.name)}</span></div><div class="flex flex-row gap-1.5 items-center shrink-0">${c.pinned === true ? icon("icon-pin") : ""}<span>${esc(c.time)}</span></div></div><div class="flex min-w-0 flex-row items-center justify-between gap-4"><div class="min-w-0 flex-1 overflow-hidden"><span>${esc(c.preview)}</span></div><div class="flex flex-row gap-1.5 items-center shrink-0">${c.muted === true ? icon("icon-bell-off") : ""}${c.unread === true ? icon("icon-circle-fill") : ""}</div></div></div></div>`;

const host = (inner: string) =>
  `<div data-testid="xchatEmbedRoute"><template data-shadow><div data-testid="dm-container" class="flex w-full">${inner}</div></template></div>`;

const inbox = (chat: MockChat) => {
  const rows = chat.conversations
    .map(
      (c, i) =>
        `<div aria-description="${esc(c.name)}" data-testid="dm-conversation-item-${esc(c.id)}" data-selected="false" data-index="${i + 1}"><a href="${link(c)}" draggable="false" class="block">${inboxRow(c)}</a></div>`,
    )
    .join("");
  // X's "Message Requests" row atop the inbox: who asked, and X's dot while unseen.
  const asked =
    chat.requests.length === 1
      ? chat.requests[0]!.name
      : `${chat.requests.length} message requests`;
  const requests = `<div data-testid="dm-message-requests-list-item" data-index="0"><a href="/i/chat/requests" aria-label="Message Requests, unread" data-testid="dm-message-requests-inbox-row" class="block w-full"><div data-inbox-row="" class="group mx-4 flex flex-row gap-4"><div class="py-3"><div class="flex size-12 items-center justify-center rounded-full">${icon("icon-mail")}</div></div><div class="flex min-w-0 flex-1 flex-col justify-center gap-1"><div class="text-body flex min-w-0 flex-row items-center justify-between gap-1.5 font-medium"><div class="min-w-0 flex-1"><span>Message Requests</span></div>${icon("icon-chevron-right")}</div><div class="flex min-w-0 flex-row items-center justify-between gap-4"><div class="min-w-0 flex-1 overflow-hidden"><span>${esc(asked)}</span></div>${icon("icon-circle-fill", "dm-message-requests-inbox-row-unread")}</div></div></div></a></div>`;
  // X's search results: one option per match, by the conversation's own link.
  const options = chat.conversations
    .map(
      (c) =>
        `<a id="dm-search-conversation-option-${esc(c.id)}" role="option" aria-selected="false" href="${link(c)}" data-name="${esc(c.name)}"><div class="size-14">${faces(c.avatars)}</div><div class="mt-2 flex max-w-full"><span>${esc(c.name)}</span></div><span>${c.id.startsWith("g") ? "3 people" : "@someone"}</span></a>`,
    )
    .join("");
  return host(
    `<div data-testid="dm-inbox-panel"><div data-testid="dm-inbox-header"><div data-testid="dm-inbox-header-main"><span data-testid="dm-inbox-title">Chat</span><button data-testid="dm-inbox-dropdown-trigger">All</button><button data-testid="dm-new-chat-button" aria-label="New chat">+</button></div></div><div data-testid="dm-search-bar"><input data-testid="dm-search-input" placeholder="Search" aria-label="Search" autocomplete="off"><button type="button" data-testid="dm-search-close" aria-label="Close search">✕</button></div><div data-testid="dm-conversation-scroller" id="x-chat-conversation-list" style="overflow-y: auto; max-height: 70vh">${requests}${rows}</div><template data-mock-search>${options}</template></div>`,
  );
};

const requestsPage = (list: ReadonlyArray<MockConversation>, other: boolean) =>
  host(
    `<div data-testid="dm-inbox-panel"><div data-testid="dm-message-requests" class="flex h-full w-full flex-col"><div class="flex items-center gap-4 px-4 pt-4 pb-4"><button aria-label="Back" data-testid="dm-message-requests-back">←</button><div class="flex-1">${other ? "Other" : "Message Requests"}</div>${other ? "" : `<button data-testid="dm-message-requests-other-button">Other</button>`}</div>${other ? `<div data-testid="dm-message-requests-other-disclaimer">These message requests may be spam or lower priority.</div>` : ""}${
      list.length === 0
        ? `<div data-testid="dm-message-requests-empty">Nothing to see here, yet</div>`
        : list
            .map(
              (c) =>
                `<div><a href="${link(c, other ? "/i/chat/requests/other" : "/i/chat/requests")}" class="block" data-testid="dm-message-request-item-${esc(c.id)}">${inboxRow(c)}</a></div>`,
            )
            .join("")
    }</div></div>`,
  );

/** X's message (pin-page-rweb): hidden labels for who and when, its words, then its reactions. */
const message = (m: MockMessage, i: number) => {
  const uid = `:r${i}:`;
  const footer = `<div class="flex items-center ml-auto shrink-0 gap-1"><span class="inline-flex items-center gap-1">${esc(m.time)}</span></div>`;
  const words =
    m.text === ""
      ? ""
      : `<div class="relative" role="article"><div data-testid="message-text-${m.id}" class="relative flex justify-end px-3.5 py-2.5 rounded-chat-bubble"><div class="relative inline-flex flex-wrap items-end gap-2 overflow-hidden"><span><span>${esc(m.text)}</span><span aria-hidden="true" class="user-select-none inline-block pl-2 opacity-0">${footer}</span></span><div class="absolute bottom-0 inset-e-0">${footer}</div></div></div></div>`;
  const media =
    m.media === undefined
      ? ""
      : `<div class="relative" role="group"><div class="rounded-chat-bubble media"><img alt="" src="blob:mock"></div></div>`;
  const reactions =
    m.reactions === undefined
      ? ""
      : `<div class="flex flex-col gap-2 pb-1" style="grid-area: message-info"><div class="relative mx-3 flex flex-row gap-1 -mt-2.5">${m.reactions
          .map(
            (r) =>
              `<button type="button" aria-label="Who reacted with ${esc(r.emoji)}" class="inline-flex rounded-full"><div class="inline-flex h-5 items-center"><span>${esc(r.emoji)}</span></div>${r.count > 1 ? `<span>${r.count}</span>` : ""}</button>`,
          )
          .join("")}</div></div>`;
  return `<div class="relative flex w-full px-4 ${m.mine ? "justify-end" : "justify-start"}" data-testid="message-${m.id}" data-send-status="sent"><div class="absolute inset-0 z-0" aria-hidden="true"></div><span hidden id="${uid}-sender">${esc(m.sender)}</span><span hidden id="${uid}-time">${esc(m.time)}</span>${m.media === undefined ? "" : `<span hidden id="${uid}-kind">${esc(m.media)}</span>`}<div class="relative z-10 grid"><div class="self-end" style="grid-area: avatar"></div><div class="flex min-w-0 flex-col gap-1" style="grid-area: content">${media}${words}</div>${reactions}</div></div>`;
};

const conversationPage = (c: MockConversation) =>
  host(
    `<div data-testid="dm-conversation-panel"><div data-testid="dm-conversation-header"><button data-testid="dm-conversation-back-button" aria-label="Back">←</button>${faces(c.avatars)}<span data-testid="dm-conversation-username">${esc(c.name)}</span><button data-testid="dm-conversation-more-button" aria-label="More">…</button></div><div data-testid="dm-message-list" class="relative h-full"><div data-testid="dm-message-scroller" style="overflow-y: auto; max-height: 70vh"><div data-testid="dm-informational-item-today">Today</div>${c.messages.map(message).join("")}</div></div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea" placeholder="Message"></textarea><button data-testid="dm-composer-send-button" aria-label="Send">➤</button></div></div>`,
  );

/** X's passcode screen, which X shows until the user types the chat passcode in X's page. */
const pinPage = () =>
  host(
    `<div class="mx-auto flex max-w-md grow flex-col items-center justify-center gap-6 text-center"><h1 data-testid="pin-title">Enter your passcode</h1><div role="group" aria-label="Passcode" data-testid="pin-code-input-container">${'<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1">'.repeat(4)}</div><button data-testid="pin-forgot-pin">Forgot passcode</button></div>`,
  );

/** Mock X's page for a path under /i/chat: the passcode screen while locked, else what X draws. */
export function chatPage(chat: MockChat, path: string): { title: string; html: string } {
  const title = "Chat / X";
  if (chat.locked) return { title, html: pinPage() };
  if (path === "/i/chat") return { title, html: inbox(chat) };
  if (path === "/i/chat/requests") return { title, html: requestsPage(chat.requests, false) };
  if (path === "/i/chat/requests/other") return { title, html: requestsPage(chat.other, true) };
  const id = path.split("/").at(-1) ?? "";
  const c = [...chat.conversations, ...chat.requests, ...chat.other].find(
    (x) => x.id.replace(":", "-") === id,
  );
  if (c === undefined) return { title, html: inbox(chat) };
  chat.opened.push(path);
  return { title, html: conversationPage(c) };
}
