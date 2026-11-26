import type { EngineUser } from "@xtend/contracts";

/**
 * Mock X's Chat as X's chat embed (abs.twimg.com/x-web/xchat/embed) draws it: X's test ids and
 * markup in an open shadow root on `xchatEmbedRoute`, and no x.com GraphQL. Controls X draws on
 * demand (hover bar, "...", reaction picker) ride in templates the page script shows; what they
 * change goes to `/__mock/chat` (`write`).
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
  text: string;
  readonly time: string;
  readonly media?: string;
  reactions?: Array<{ readonly emoji: string; count: number }>;
  /** The signed-in user's reaction, which X's picker marks pressed. */
  reacted?: string;
  /** The message this one answers, which X quotes above it. */
  readonly replyTo?: string;
}

interface MockConversation {
  /** X's id: `<low>:<high>` user ids, or `g<id>` for a group. Its link dashes the colon. */
  readonly id: string;
  readonly name: string;
  readonly handle?: string;
  readonly avatars: ReadonlyArray<string>;
  readonly time: string;
  readonly preview: string;
  readonly unread?: boolean;
  readonly muted?: boolean;
  readonly pinned?: boolean;
  readonly messages: Array<MockMessage>;
}

/** X's quick reactions, as its picker offers them before the user picks others (pin-page-rweb). */
const QUICK = ["👍", "👎", "❤️", "😂", "🎉", "😮"];

const oneToOne = (u: EngineUser) =>
  BigInt(u.userId) < BigInt(ME) ? `${u.userId}:${ME}` : `${ME}:${u.userId}`;
const link = (c: MockConversation, base = "/i/chat") => `${base}/${c.id.replace(":", "-")}`;

/** What mock X's Chat holds: made-up conversations with the fixtures' people, and its lock. */
export function createMockChat(locked: boolean, people: ReadonlyArray<EngineUser>) {
  const [a, b, c, d, e, f] = people;
  if (f === undefined) throw new Error("mock chat needs six fixture people");
  const face = (u: EngineUser) => u.avatarUrl ?? "";
  const conversations: Array<MockConversation> = [
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
  const requests: Array<MockConversation> = [
    {
      id: oneToOne(e!),
      name: e!.name,
      handle: e!.handle,
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
  const other: Array<MockConversation> = [
    {
      id: oneToOne(f),
      name: f.name,
      handle: f.handle,
      avatars: [face(f)],
      time: "4d",
      preview: "Claim your prize",
      messages: [
        { id: "m9", mine: false, sender: f.name, text: "Claim your prize", time: "Oct 30" },
      ],
    },
  ];
  let isLocked = locked;
  let sent = 0;
  const writes: Array<string> = [];
  const find = (id: string) => [...conversations, ...requests, ...other].find((c) => c.id === id);
  return {
    conversations,
    requests,
    other,
    /** Conversation pages X's page opened, in order: X marks a conversation read once it opens. */
    opened: [] as Array<string>,
    /** What X's controls changed, in order: `<kind> <message or conversation>`. */
    writes,
    get locked() {
      return isLocked;
    },
    /** The user typed X's passcode. */
    unlock: () => {
      isLocked = false;
    },
    /** What one of X's controls does, as X's page asks for it. */
    write: (body: Record<string, unknown>) => {
      const c = find(String(body.conversation));
      const m = c?.messages.find((x) => x.id === body.message);
      const kind = String(body.kind);
      if (c === undefined) return false;
      if (kind === "send") {
        const id = `s${++sent}`;
        c.messages.push({
          id,
          mine: true,
          sender: "You",
          text: String(body.text),
          time: "now",
          ...(typeof body.replyTo === "string" ? { replyTo: body.replyTo } : {}),
        });
        writes.push(`send ${id}`);
        return true;
      }
      if (kind === "accept" || kind === "decline") {
        for (const list of [requests, other]) {
          const at = list.indexOf(c);
          if (at !== -1) list.splice(at, 1);
        }
        if (kind === "accept") conversations.unshift(c);
        writes.push(`${kind} ${c.id}`);
        return true;
      }
      if (m === undefined) return false;
      if (kind === "edit") m.text = String(body.text);
      else if (kind === "delete") c.messages.splice(c.messages.indexOf(m), 1);
      else if (kind === "react") {
        const emoji = String(body.emoji);
        const list = (m.reactions ??= []);
        // X's picker takes the user's reaction back when it is picked again, and swaps another.
        for (const mine of m.reacted === undefined ? [] : [m.reacted]) {
          const r = list.find((x) => x.emoji === mine);
          if (r !== undefined && --r.count === 0) list.splice(list.indexOf(r), 1);
        }
        if (m.reacted === emoji) delete m.reacted;
        else {
          m.reacted = emoji;
          const r = list.find((x) => x.emoji === emoji);
          if (r === undefined) list.push({ emoji, count: 1 });
          else r.count++;
        }
      } else return false;
      writes.push(`${kind} ${m.id}`);
      return true;
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

/** X's rows in a message's "..." (pin-page-rweb's overflow, in Mobbin's order), each with X's icon. */
const rows = (m: MockMessage): ReadonlyArray<readonly [icon: string, label: string]> => [
  ["icon-reply-arrow", "Reply"],
  ["icon-forward-stroke", "Forward"],
  ...(m.mine ? [["icon-pencil-stroke", "Edit message"] as const] : []),
  ...(m.text === "" ? [] : [["icon-clone", "Copy message text"] as const]),
  ["icon-information-circle", "Info"],
  ...(m.media === undefined ? [] : [["icon-arrow-down", "Download"] as const]),
  ...(m.mine ? [] : [["icon-flag", "Report message"] as const]),
  ["icon-trashcan-stroke", "Delete for me"],
  ...(m.mine ? [["icon-trashcan-stroke", "Delete for all"] as const] : []),
];

/**
 * What X draws on a message once the pointer is over it, for the page script to show: its hover
 * bar (React, Reply, "..."), the "..." menu and X's quick reaction picker, the user's marked.
 */
const controls = (m: MockMessage) =>
  `<template data-mock-hover><div class="hover-bar"><button type="button" aria-label="React" aria-expanded="false" data-testid="message-reaction-button-${m.id}">${icon("icon-heart-plus-stroke")}</button><button type="button" aria-label="Reply" data-testid="message-reply-button-${m.id}">${icon("icon-reply-arrow")}</button><button type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false" data-testid="message-overflow-button-${m.id}">${icon("icon-more")}</button></div></template><template data-mock-menu><div role="menu" data-mock-text="${esc(m.text)}" data-mock-sender="${esc(m.sender)}">${rows(
    m,
  )
    .map(
      ([name, label]) =>
        `<div role="menuitem" tabindex="-1">${icon(name)}<span>${esc(label)}</span></div>`,
    )
    .join(
      "",
    )}</div></template><template data-mock-reactions><div role="dialog"><div tabindex="0">${QUICK.map(
    (e) =>
      `<button type="button" aria-label="${e}" aria-pressed="${m.reacted === e}">${e}</button>`,
  ).join("")}<button type="button" aria-label="More reactions">+</button></div></div></template>`;

/** X's message (pin-page-rweb): hidden labels for who and when, its words, then its reactions. */
const message = (m: MockMessage, i: number, writable: boolean) => {
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
  return `<div class="relative flex w-full px-4 ${m.mine ? "justify-end" : "justify-start"}" data-testid="message-${m.id}" data-send-status="sent"><div class="absolute inset-0 z-0" aria-hidden="true"></div><span hidden id="${uid}-sender">${esc(m.sender)}</span><span hidden id="${uid}-time">${esc(m.time)}</span>${m.media === undefined ? "" : `<span hidden id="${uid}-kind">${esc(m.media)}</span>`}<div class="relative z-10 grid"><div class="self-end" style="grid-area: avatar"></div><div class="flex min-w-0 flex-col gap-1" style="grid-area: content">${media}${words}</div>${reactions}</div>${writable ? controls(m) : ""}</div>`;
};

/**
 * X's composer: its field, and its voice button until there is text to send, when X's Send takes
 * its place (pin-screen). The page script swaps them as X does, and shows X's reply and edit bars.
 */
const composer = `<div data-testid="dm-composer-container"><div data-testid="dm-composer-form"><textarea data-testid="dm-composer-textarea" placeholder="Message" aria-label="Message"></textarea><button type="button" data-testid="dm-composer-voice-button" aria-label="Record voice message">${icon("icon-voice")}</button></div></div>`;

/** X's prompt in place of the composer while a request waits for the user (pin-page-rweb). */
const requestPrompt = (c: MockConversation) =>
  `<div data-testid="dm-message-request-prompt"><div data-testid="dm-message-request-description">Accept message requests from <a href="https://x.com/${esc(c.handle ?? "")}" data-testid="dm-message-request-profile-link">@${esc(c.handle ?? "")}</a></div><div><button type="button" data-testid="dm-message-request-delete-button">Delete</button><button type="button" data-testid="dm-message-request-accept-button">Accept</button></div></div>`;

const conversationPage = (c: MockConversation, requested: boolean) =>
  host(
    `<div data-testid="dm-conversation-panel" data-mock-conversation="${esc(c.id)}"><div data-testid="dm-conversation-header"><button data-testid="dm-conversation-back-button" aria-label="Back">←</button>${faces(c.avatars)}<span data-testid="dm-conversation-username">${esc(c.name)}</span><button data-testid="dm-conversation-more-button" aria-label="More">…</button></div><div data-testid="dm-message-list" class="relative h-full"><div data-testid="dm-message-scroller" style="overflow-y: auto; max-height: 70vh"><div data-testid="dm-informational-item-today">Today</div>${c.messages.map((m, i) => message(m, i, !requested)).join("")}</div></div>${requested ? requestPrompt(c) : composer}</div>`,
  );

/** X's page about a conversation (its info), which X's More opens; Back returns to it. */
const infoPage = (c: MockConversation, path: string) =>
  host(
    `<div data-testid="dm-conversation-info"><a href="${esc(path)}" aria-label="Back">←</a><span>${esc(c.name)}</span><div>Nickname</div><div>Disappearing Messages</div><div>Safety Number</div><div>Block Messages</div></div>`,
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
  const info = path.endsWith("/info");
  const at = info ? path.slice(0, -"/info".length) : path;
  const id = at.split("/").at(-1) ?? "";
  const c = [...chat.conversations, ...chat.requests, ...chat.other].find(
    (x) => x.id.replace(":", "-") === id,
  );
  if (c === undefined) return { title, html: inbox(chat) };
  if (info) return { title, html: infoPage(c, at) };
  chat.opened.push(path);
  return { title, html: conversationPage(c, !chat.conversations.includes(c)) };
}
