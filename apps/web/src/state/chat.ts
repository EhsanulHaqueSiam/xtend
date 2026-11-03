import * as Atom from "effect/reactivity/Atom";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { xRun, xRunHeld } from "./x";

/**
 * X's Chat, read from X's own page. Its messages are end-to-end encrypted: X's answers carry no
 * text, so the only place a chat is readable is what X's chat embed draws, in open shadow roots on
 * x.com. The engine reads that, and only while Xtend's Chat screen is open. What it reads lives in
 * this module's atom and nowhere else: never in an engine batch, the service, a log or the bench.
 */

const ChatRow = Schema.Struct({
  /** X's conversation id, from its test id: `<low user id>:<high user id>`, or `g<id>` for a group. */
  id: Schema.String,
  /** X's own link to the conversation, which opens it in X's router. */
  href: Schema.String,
  name: Schema.String,
  avatars: Schema.Array(Schema.String),
  preview: Schema.String,
  /** X's narrow time, as drawn ("2h"). */
  time: Schema.String,
  unread: Schema.Boolean,
  muted: Schema.Boolean,
  pinned: Schema.Boolean,
  group: Schema.Boolean,
});
export type ChatRow = typeof ChatRow.Type;

const ChatMessage = Schema.Struct({
  kind: Schema.Literal("message"),
  id: Schema.String,
  mine: Schema.Boolean,
  /** X's label for who sent it: their name, or "You". */
  sender: Schema.String,
  text: Schema.String,
  time: Schema.NullOr(Schema.String),
  /** X's word for an attachment (Photo, Video, GIF, Voice message, Attachment), shown in its place. */
  media: Schema.NullOr(Schema.String),
  reactions: Schema.Array(Schema.Struct({ emoji: Schema.String, count: Schema.Number })),
});
/** X's lines between messages: a day, "You accepted the request". */
const ChatInfo = Schema.Struct({
  kind: Schema.Literal("info"),
  id: Schema.String,
  text: Schema.String,
});
const ChatItem = Schema.Union([ChatMessage, ChatInfo]);
export type ChatItem = typeof ChatItem.Type;

/** One look at X's Chat. A null part is one X does not draw now (another page, still loading). */
const ChatRead = Schema.Struct({
  path: Schema.String,
  /** X shows its passcode screen: nothing else is readable until the user types it in X. */
  locked: Schema.Boolean,
  inbox: Schema.NullOr(Schema.Array(ChatRow)),
  /** X's "Message Requests" row atop the inbox: who asked, as X sums it up. */
  requestsRow: Schema.NullOr(Schema.Struct({ summary: Schema.String, unread: Schema.Boolean })),
  requests: Schema.NullOr(Schema.Array(ChatRow)),
  title: Schema.NullOr(Schema.String),
  items: Schema.NullOr(Schema.Array(ChatItem)),
  search: Schema.NullOr(Schema.Array(ChatRow)),
});
export type ChatRead = typeof ChatRead.Type;

/**
 * What X's chat embed draws on X's page at `path`, by X's own test ids and markup. Runs in X's
 * page as its own source (`readChat.toString()`), so it uses nothing outside itself.
 */
export function readChat(doc: Document, path: string): ChatRead {
  const roots = [...doc.querySelectorAll('[data-testid^="xchatEmbed"]')].flatMap((host) =>
    host.shadowRoot === null ? [] : [host.shadowRoot],
  );
  const all = (selector: string) => roots.flatMap((r) => [...r.querySelectorAll(selector)]);
  const has = (selector: string) => all(selector).length > 0;
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
  // X's row (its inbox, requests and search results share it): face, then name and time over
  // preview, then muted and unread marks.
  const row = (item: Element, id: string): ChatRow | null => {
    const link = item.matches("a[href]") ? item : item.querySelector("a[href]");
    const body = item.querySelector("[data-inbox-row]")?.children[1];
    const [head, sub] = [...(body?.children ?? [])];
    if (link === null || head === undefined) return null;
    return {
      id,
      href: link.getAttribute("href") ?? "",
      name: text(head.firstElementChild),
      avatars: [...item.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? ""),
      preview: text(sub?.firstElementChild),
      time: text(head.children[1]),
      unread: sub?.querySelector('[data-icon="icon-circle-fill"]') != null,
      muted: sub?.querySelector('[data-icon="icon-bell-off"]') != null,
      pinned: head.querySelector('[data-icon="icon-pin"]') != null,
      group: id.startsWith("g"),
    };
  };
  const rows = (selector: string, prefix: string, empty: string) => {
    const found = all(selector).flatMap((el) => {
      const r = row(el, (el.getAttribute("data-testid") ?? "").slice(prefix.length));
      return r === null ? [] : [r];
    });
    return found.length > 0 || has(empty) ? found : null;
  };
  // A message's words without X's footer (its time and ticks) or Show more.
  const words = (el: Element | null) => {
    if (el === null) return "";
    const copy = el.cloneNode(true) as Element;
    for (const extra of copy.querySelectorAll('[aria-hidden="true"], .absolute, button'))
      extra.remove();
    return text(copy);
  };
  const item = (el: Element): ChatItem => {
    const testid = el.getAttribute("data-testid") ?? "";
    if (testid.startsWith("dm-informational-item-"))
      return { kind: "info", id: testid.slice(22), text: text(el) };
    const id = testid.slice("message-".length);
    return {
      kind: "message",
      id,
      mine: el.classList.contains("justify-end"),
      sender: text(el.querySelector('span[hidden][id$="-sender"]')),
      text: words(el.querySelector(`[data-testid="message-text-${CSS.escape(id)}"]`)),
      time: text(el.querySelector('span[hidden][id$="-time"]')) || null,
      media: text(el.querySelector('span[hidden][id$="-kind"]')) || null,
      reactions: [...el.querySelectorAll('[style*="message-info"] button')].map((b) => ({
        emoji: text(b.children[0]),
        count: Number(text(b.children[1]) || "1") || 1,
      })),
    };
  };
  const list = all('[data-testid="dm-message-list"]')[0];
  const items =
    list === undefined
      ? []
      : [
          ...list.querySelectorAll(
            '[data-testid^="message-"][data-send-status], [data-testid^="dm-informational-item-"]',
          ),
        ].map(item);
  const requestsRow = all('[data-testid="dm-message-requests-inbox-row"]')[0];
  const searching = all('[data-testid="dm-search-input"]').some(
    (i) => i instanceof HTMLInputElement && i.value.trim() !== "",
  );
  const options = all('[id^="dm-search-conversation-option-"]').flatMap((el) => {
    const [face, title, line] = [...el.children];
    const href = el.getAttribute("href") ?? "";
    // X's results name the conversation in the link; its row id is the result's own.
    const id = href.split("/").at(-1)?.replaceAll("-", ":") ?? "";
    return [
      {
        id,
        href,
        name: text(title),
        avatars: [...(face?.querySelectorAll("img") ?? [])].map((i) => i.getAttribute("src") ?? ""),
        preview: text(line),
        time: "",
        unread: false,
        muted: false,
        pinned: false,
        group: id.startsWith("g"),
      },
    ];
  });
  return {
    path,
    locked: has('[data-testid="pin-code-input-container"], [data-testid="pin-title"]'),
    inbox: has('[data-testid="dm-inbox-panel"]')
      ? rows(
          '[data-testid^="dm-conversation-item-"]',
          "dm-conversation-item-",
          '[data-testid="dm-empty-inbox"]',
        )
      : null,
    requestsRow:
      requestsRow === undefined
        ? null
        : {
            summary: text(requestsRow.querySelector("[data-inbox-row]")?.children[1]?.children[1]),
            unread:
              requestsRow.querySelector('[data-testid="dm-message-requests-inbox-row-unread"]') !=
              null,
          },
    requests: rows(
      '[data-testid^="dm-message-request-item-"]',
      "dm-message-request-item-",
      '[data-testid="dm-message-requests-empty"]',
    ),
    title: text(all('[data-testid="dm-conversation-username"]')[0]) || null,
    items: items.length > 0 ? items : null,
    search: searching ? options : null,
  };
}

/** The Chat screen's copy of X's Chat; in memory only, so an account switch (a new window) drops it. */
export interface ChatState {
  readonly path: string | null;
  readonly locked: boolean;
  readonly inbox: ReadonlyArray<ChatRow> | null;
  readonly requestsRow: ChatRead["requestsRow"];
  readonly requests: { readonly path: string; readonly rows: ReadonlyArray<ChatRow> } | null;
  /**
   * The conversation X last drew, by X's path. `first` is its first item's list index: it drops
   * by as many as X drew above it, so a list keeps its place when older messages arrive.
   */
  readonly conversation: {
    readonly path: string;
    readonly title: string | null;
    readonly items: ReadonlyArray<ChatItem>;
    readonly first: number;
  } | null;
  readonly search: ReadonlyArray<ChatRow> | null;
}

export const emptyChat: ChatState = {
  path: null,
  locked: false,
  inbox: null,
  requestsRow: null,
  requests: null,
  conversation: null,
  search: null,
};

export const chatAtom = Atom.make(emptyChat).pipe(Atom.keepAlive);

/**
 * `known` with X's window `read` laid over it. X draws only the rows near its scroll, so a read is
 * a window: what X draws between two of its rows is all there is there (a row gone was deleted),
 * a row X moved (a new message lifts a conversation) moves, and what lies outside the window stays.
 */
export const mergeWindow = <A extends { readonly id: string }>(
  known: ReadonlyArray<A>,
  read: ReadonlyArray<A>,
): ReadonlyArray<A> => {
  const at = new Map(known.map((k, i) => [k.id, i]));
  const shown = new Set(read.map((r) => r.id));
  const first = known.findIndex((k) => shown.has(k.id));
  if (first === -1) return read;
  const gone = new Set<number>();
  for (let i = 1; i < read.length; i++) {
    const from = at.get(read[i - 1]!.id);
    const to = at.get(read[i]!.id);
    if (from !== undefined && to !== undefined) for (let j = from + 1; j < to; j++) gone.add(j);
  }
  const rest = known.filter((k, i) => !shown.has(k.id) && !gone.has(i));
  return [...rest.slice(0, first), ...read, ...rest.slice(first)];
};

/** Where a conversation's list starts counting, so older items can take the indexes before it. */
const FIRST = 1_000_000;

/** The Chat screen's state after one read of X's page. */
export const mergeChat = (state: ChatState, read: ChatRead): ChatState => {
  const was = state.conversation?.path === read.path ? state.conversation : null;
  const items = read.items === null ? null : mergeWindow(was?.items ?? [], read.items);
  const top = was?.items[0];
  const lifted = top === undefined || items === null ? 0 : items.findIndex((i) => i.id === top.id);
  return {
    path: read.path,
    locked: read.locked,
    inbox:
      read.inbox !== null
        ? mergeWindow(state.inbox ?? [], read.inbox)
        : state.inbox?.some((r) => r.href === read.path && r.unread)
          ? // X marks the conversation it shows read: so does the inbox kept while X draws none.
            state.inbox.map((r) => (r.href === read.path ? { ...r, unread: false } : r))
          : state.inbox,
    requestsRow: read.inbox === null ? state.requestsRow : read.requestsRow,
    requests: read.requests === null ? state.requests : { path: read.path, rows: read.requests },
    conversation:
      items === null
        ? state.conversation
        : {
            path: read.path,
            title: read.title ?? was?.title ?? null,
            items,
            first: (was?.first ?? FIRST) - Math.max(0, lifted),
          },
    search: read.search,
  };
};

const decodeRead = Schema.decodeUnknownOption(
  Schema.Struct({ hash: Schema.String, read: ChatRead }),
);

/**
 * The next look at X's Chat that differs from the one hashed `last`: X's page watches its chat
 * roots and answers once they change, or after a while with what it has. Null when the page could
 * not answer (none, or loading anew).
 */
const nextRead = async (last: string, token: number, signal: AbortSignal) => {
  const answer = await xRunHeld(
    `(async () => {
    const read = ${readChat.toString()};
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const look = () => { const read_ = read(document, location.pathname); return { hash: hash(JSON.stringify(read_)), read: read_ }; };
    const now = look();
    if (now.hash !== ${JSON.stringify(last)}) return now;
    return new Promise((done) => {
      let quiet;
      const end = () => {
        observer.disconnect(); clearTimeout(quiet); clearTimeout(cap);
        if (window.__xtendChatWatch?.token === ${token}) delete window.__xtendChatWatch;
      };
      const finish = () => { end(); done(look()); };
      const watch = () => {
        for (const host of document.querySelectorAll('[data-testid^="xchatEmbed"]'))
          if (host.shadowRoot) observer.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true });
      };
      // X draws a burst of changes at once: one look once it settles.
      const observer = new MutationObserver(() => {
        watch();
        clearTimeout(quiet);
        quiet = setTimeout(() => { if (look().hash !== ${JSON.stringify(last)}) finish(); }, 120);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      watch();
      const cap = setTimeout(finish, 20000);
      window.__xtendChatWatch = { token: ${token}, stop: () => { end(); done(null); } };
    });
  })()`,
    signal,
  );
  return Option.getOrNull(decodeRead(answer));
};

let watches = 0;

/**
 * Reads X's Chat into `onRead` until `signal` ends it: each time X's chat redraws. Only for the
 * Chat screen while it is open; a page that could not answer is asked again a second later.
 */
export const watchChat = (signal: AbortSignal, onRead: (read: ChatRead) => void) => {
  const token = ++watches;
  // X's page holds its own watch until told: ending here ends it there too, reading nothing more.
  signal.addEventListener(
    "abort",
    () =>
      void xRun(
        `window.__xtendChatWatch?.token === ${token} && window.__xtendChatWatch.stop(), true`,
      ),
    { once: true },
  );
  void (async () => {
    let last = "";
    while (!signal.aborted) {
      const next = await nextRead(last, token, signal);
      if (signal.aborted) return;
      if (next === null) await new Promise((r) => setTimeout(r, 1000));
      else {
        last = next.hash;
        onRead(next.read);
      }
    }
  })();
};

/**
 * Scrolls X's own list one screen, so X draws what lies past it: the inbox down to older
 * conversations, a conversation up to older messages. Reads nothing and presses nothing.
 */
export const xChatScroll = (list: "inbox" | "messages") =>
  xRun(`(() => {
    const testid = ${JSON.stringify(list === "inbox" ? "dm-conversation-scroller" : "dm-message-list")};
    const roots = [...document.querySelectorAll('[data-testid^="xchatEmbed"]')].flatMap((h) => (h.shadowRoot ? [h.shadowRoot] : []));
    const box = roots.map((r) => r.querySelector('[data-testid="' + testid + '"]')).find(Boolean);
    const scroller = box && [box, ...box.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (!scroller) return false;
    scroller.scrollBy(0, ${list === "inbox" ? 1 : -1} * scroller.clientHeight * 0.8);
    return true;
  })()`);

/**
 * Types `query` into the search of X's Chat page (never a chat drawer) as a keystroke does; "" closes
 * it, only while X's field still holds the query Xtend typed. `wait`: X was just moved, so its field
 * gets a moment. False when X draws none (its conversation and requests pages). Nothing is sent.
 */
export const xChatSearch = (query: string, wait = false) =>
  xRun(`(async () => {
    const query = ${JSON.stringify(query)};
    const field = () => {
      const onChat = location.pathname === "/i/chat" || location.pathname.startsWith("/i/chat/");
      const input = onChat ? document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot?.querySelector('[data-testid="dm-search-input"]') : null;
      return input instanceof HTMLInputElement ? input : null;
    };
    for (let i = 0; i < ${wait ? 20 : 0} && field() === null; i++) await new Promise((r) => setTimeout(r, 150));
    const input = field();
    if (input === null) return false;
    const root = input.getRootNode();
    const mine = window.__xtendChatQuery;
    if (query === "") {
      delete window.__xtendChatQuery;
      if (mine !== undefined && input.value === mine) root.querySelector('[data-testid="dm-search-close"]')?.click();
      return true;
    }
    // React keeps the field's value itself: its native setter and an input event are a keystroke.
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    window.__xtendChatQuery = query;
    return true;
  })()`);

/** X's paths a Chat screen may open: X's own row links, never anything else. */
export const isChatPath = (path: string) =>
  /^\/i\/chat(\/requests(\/other)?)?(\/[A-Za-z0-9_-]{1,80})?$/.test(path);
