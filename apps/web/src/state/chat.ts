import * as Atom from "effect/reactivity/Atom";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { xPressOver, xRun, xRunHeld } from "./x";

/**
 * X's Chat through X's own page: its messages are end-to-end encrypted, so only X's chat embed
 * draws them, in open shadow roots on x.com, read while Chat is open and written through X's own
 * controls for the user's click. What it reads stays in this module's atom: never an engine
 * batch, the service, a log or the bench.
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
  /** X's own mark: "pending" until X's page has sent it, "failed" when it could not. */
  status: Schema.Literals(["sent", "pending", "failed"]),
});
export type ChatMessage = typeof ChatMessage.Type;
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
  /** X draws its composer on the conversation: the user can write in it. */
  composer: Schema.Boolean,
  /** X asks the user to accept this conversation's request first, in its own words. */
  request: Schema.NullOr(Schema.String),
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
      status:
        (["pending", "failed"] as const).find((s) => s === el.getAttribute("data-send-status")) ??
        "sent",
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
  const composer = has('[data-testid="dm-composer-textarea"]');
  const request = has('[data-testid="dm-message-request-prompt"]')
    ? text(all('[data-testid="dm-message-request-description"]')[0])
    : null;
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
    // A conversation with no messages yet (one just started) is drawn once X draws its composer.
    items: items.length > 0 || composer || request !== null ? items : null,
    composer,
    request,
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
    readonly composer: boolean;
    readonly request: string | null;
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
            composer: read.composer,
            request: read.request,
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
          // X marks a message sent or failed by its attribute alone.
          if (host.shadowRoot) observer.observe(host.shadowRoot, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-send-status"] });
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
    // Each call is the latest: a later one (the screen's own close when it goes) ends this wait.
    const run = (window.__xtendChatSearchRun = (window.__xtendChatSearchRun ?? 0) + 1);
    const field = () => {
      const onChat = location.pathname === "/i/chat" || location.pathname.startsWith("/i/chat/");
      const input = onChat ? document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot?.querySelector('[data-testid="dm-search-input"]') : null;
      return input instanceof HTMLInputElement ? input : null;
    };
    for (let i = 0; i < ${wait ? 20 : 0} && field() === null; i++) await new Promise((r) => setTimeout(r, 150));
    if (window.__xtendChatSearchRun !== run) return false;
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

/**
 * Script steps in X's page: X's chat roots, a lookup in them, a short wait for a check, an
 * element's words as X shows them, and whether X now asks the user something of its own (a
 * dialog, or a menu X keeps open on a choice). A popup X is closing does not ask anything.
 */
const IN_CHAT = `
    const roots = () => [...document.querySelectorAll('[data-testid^="xchatEmbed"]')].flatMap((h) => (h.shadowRoot ? [h.shadowRoot] : []));
    const find = (s) => roots().map((r) => r.querySelector(s)).find(Boolean) ?? null;
    const wait = async (check, tries = 20) => {
      for (let i = 0; i < tries; i++) {
        const found = check();
        if (found) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      return check();
    };
    const words = (el) => {
      const copy = el.cloneNode(true);
      for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
      return copy.textContent.trim();
    };
    const asks = () => {
      const up = ':is([role="dialog"], [role="alertdialog"]):not([data-ending-style])';
      return !!document.querySelector(up) || roots().some((r) => r.querySelector(up + ', [role="menu"]:not([data-ending-style])'));
    };`;

/** X still asks the user something in its chat (or, with `under`, shows its page there). */
const asking = (under?: string) =>
  `(() => { ${IN_CHAT} return asks()${under === undefined ? "" : ` || location.pathname.startsWith(${JSON.stringify(under)})`}; })()`;

/**
 * Steps on message `id` in X's open conversation: `hover` shows X's hover bar on it as a pointer
 * over it does, `menu` opens X's "..." there and answers its own rows, `reactions` opens X's
 * reaction picker there and answers its emoji buttons. Each is null when X draws none.
 */
const onMessage = (id: string) => `
    const testid = (name) => '[data-testid="' + name + CSS.escape(${JSON.stringify(id)}) + '"]';
    const hover = async () => {
      const bubble = find(testid("message-"))?.querySelector('[role="group"], [role="article"]');
      if (!bubble) return null;
      const box = bubble.getBoundingClientRect();
      const at = { bubbles: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      bubble.dispatchEvent(new MouseEvent("mouseover", at));
      bubble.dispatchEvent(new MouseEvent("mousemove", at));
      return wait(() => find(testid("message-overflow-button-")));
    };
    const menu = async () => {
      const more = await hover();
      if (!more) return null;
      if (more.getAttribute("aria-expanded") !== "true") more.click();
      const open = await wait(() => {
        const menus = roots().flatMap((r) => [...r.querySelectorAll('[role="menu"]')]);
        return menus.length === 1 && menus[0].querySelector('[role="menuitem"]') ? menus[0] : null;
      });
      if (!open) return null;
      const rows = [...open.querySelectorAll('[role="menuitem"]')].filter((r) => r.closest('[role="menu"]') === open);
      return { more, open, rows };
    };
    const reactions = async () => {
      const react = (await hover()) && find(testid("message-reaction-button-"));
      if (!react) return null;
      if (react.getAttribute("aria-expanded") !== "true") react.click();
      const buttons = await wait(() => {
        const found = roots().flatMap((r) => [...r.querySelectorAll('[role="dialog"] button[aria-pressed]')]);
        return found.length > 0 ? found : null;
      });
      return buttons ? { react, buttons } : null;
    };`;

/** X's "..." on a message: each row in X's words, with its icon (the same in every language). */
const ChatMenu = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ label: Schema.String, icon: Schema.String })),
  /** What X says about the message there (when it was sent, who saw it), not pressable. */
  info: Schema.Array(Schema.String),
});
export type ChatMenu = typeof ChatMenu.Type;
const decodeMenu = Schema.decodeUnknownOption(ChatMenu);

/**
 * X's "..." on message `id` in X's conversation `path`, read for the user's click on Xtend's.
 * Presses nothing: X's menu closes again. Null when X draws no such message or menu there.
 */
export const xChatMenu = async (path: string, id: string) =>
  Option.getOrNull(
    decodeMenu(
      await xRun(`(async () => {
    ${IN_CHAT}
    ${onMessage(id)}
    if (location.pathname !== ${JSON.stringify(path)}) return null;
    const shown = await menu();
    if (!shown) return null;
    // A row opening a list of its own (who saw it) is a line about the message, as X's plain lines are.
    const rows = shown.rows.filter((r) => !r.hasAttribute("aria-haspopup")).map((r) => ({ label: words(r), icon: r.querySelector("svg[data-icon]")?.getAttribute("data-icon") ?? "" }));
    const info = [...shown.open.querySelectorAll('[role="none"], [role="menuitem"][aria-haspopup]')].map(words).filter((w) => w !== "");
    shown.more.click();
    return { rows, info };
  })()`),
    ),
  );

/**
 * Presses row `label` of X's "..." on message `id` for the user's click. What X asks next (Delete's
 * confirm, Forward's picker, Info) shows over the main area until the user answers it there.
 * "done" once X took it; null when X draws no such message or row, and nothing was pressed.
 */
export const xChatMenuPress = async (
  path: string,
  id: string,
  label: string,
  over: (shown: boolean) => void,
) => {
  const answer = await xPressOver(
    (mine) => `(async () => {
    ${IN_CHAT}
    ${onMessage(id)}
    if (location.pathname !== ${JSON.stringify(path)} || !${mine}) return null;
    const shown = await menu();
    const row = shown?.rows.find((r) => words(r) === ${JSON.stringify(label)});
    if (location.pathname !== ${JSON.stringify(path)}) return null;
    if (!row || !${mine}) return (shown?.more.click(), null);
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    return (await wait(asks, 5)) ? "over" : "done";
  })()`,
    asking(),
    over,
  );
  return answer === "over" || answer === "done" || answer === "cancelled" ? answer : null;
};

const Reactions = Schema.Array(Schema.Struct({ emoji: Schema.String, selected: Schema.Boolean }));
const decodeReactions = Schema.decodeUnknownOption(Reactions);

/**
 * X's quick reactions on message `id`, read from X's own picker for the user's click on Xtend's:
 * each emoji, and whether it is the user's reaction now. Presses nothing; null when X offers none.
 */
export const xChatReactions = async (path: string, id: string) =>
  Option.getOrNull(
    decodeReactions(
      await xRun(`(async () => {
    ${IN_CHAT}
    ${onMessage(id)}
    if (location.pathname !== ${JSON.stringify(path)}) return null;
    const picker = await reactions();
    if (!picker) return null;
    const quick = picker.buttons.map((b) => ({ emoji: b.getAttribute("aria-label") ?? "", selected: b.getAttribute("aria-pressed") === "true" }));
    picker.react.click();
    return quick;
  })()`),
    ),
  );

/**
 * Picks `emoji` in X's reaction picker on message `id` for the user's click; picking the user's
 * own reaction again takes it back, as in X. Null when X offers no such reaction there.
 */
export const xChatReact = async (path: string, id: string, emoji: string) =>
  (await xPressOver(
    (mine) => `(async () => {
    ${IN_CHAT}
    ${onMessage(id)}
    if (location.pathname !== ${JSON.stringify(path)} || !${mine}) return null;
    const picker = await reactions();
    const button = picker?.buttons.find((b) => b.getAttribute("aria-label") === ${JSON.stringify(emoji)});
    if (location.pathname !== ${JSON.stringify(path)}) return null;
    if (!button || !${mine}) return (picker?.react.click(), null);
    button.click();
    return "done";
  })()`,
    asking(),
    () => {},
  )) === "done" || null;

/** What the user writes in a conversation: a new message, a reply to one, or an edit of their own. */
export interface ChatDraft {
  readonly text: string;
  readonly mode: { readonly kind: "reply" | "edit"; readonly item: ChatMessage } | null;
}
export const emptyDraft: ChatDraft = { text: "", mode: null };

/**
 * What the user writes in X's Chat: each conversation's draft by X's path, and the one send in
 * flight, whose draft stays until X marks the message it pinned (`id`, null until X draws it).
 * In memory like `chatAtom`, so an account (a window of its own) never sees another's.
 */
export interface ChatWrite {
  readonly drafts: ReadonlyMap<string, ChatDraft>;
  readonly send: {
    readonly path: string;
    readonly text: string;
    readonly id: string | null;
  } | null;
}
export const chatWriteAtom = Atom.make<ChatWrite>({ drafts: new Map(), send: null }).pipe(
  Atom.keepAlive,
);

/** `write` once its send ends: a sent one takes its draft with it; otherwise the draft stays. */
export const endSend = (write: ChatWrite, sent: boolean): ChatWrite => {
  const drafts = new Map(write.drafts);
  if (sent && write.send !== null) drafts.delete(write.send.path);
  return { drafts, send: null };
};

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * X's mark, in `read`, on the message the send in flight pinned: "sent" once X marks it so with the
 * sent text (an edit shows its new text), "failed", or null while X has neither.
 */
export const sendMark = ({ send }: ChatWrite, read: ChatRead) => {
  if (send?.id == null || read.path !== send.path) return null;
  const message = read.items?.find((i) => i.id === send.id);
  if (message?.kind !== "message") return null;
  if (message.status === "failed") return "failed";
  return message.status === "sent" && squash(message.text) === squash(send.text) ? "sent" : null;
};

const Sent = Schema.Struct({
  status: Schema.Literals(["sent", "pending", "failed", "draft"]),
  /** X's id for the message this send pinned; null when X drew none. */
  id: Schema.NullOr(Schema.String),
});
const decodeSent = Schema.decodeUnknownOption(Sent);

/**
 * Sends `text` in X's conversation `path`, whose messages Xtend knows by `known`, for the user's
 * click: through X's own composer and Send (Save, for `edit`), after X's own Reply or Edit there.
 * X's mark on the message it pins answers: "sent", "failed", or "pending" while X still sends;
 * "draft" when X's composer already holds something of the user's. Null when nothing was sent.
 */
export const xChatSend = async (
  path: string,
  text: string,
  known: ReadonlyArray<string>,
  to: { readonly reply?: string; readonly edit?: string } = {},
) =>
  Option.getOrNull(
    decodeSent(
      await xPressOver(
        (mine) => `(async () => {
    ${IN_CHAT}
    ${onMessage(to.reply ?? to.edit ?? "")}
    const read = ${readChat.toString()};
    const path = ${JSON.stringify(path)};
    const text = ${JSON.stringify(text)};
    const squash = (s) => s.replace(/\\s+/g, "");
    const route = () => document.querySelector('[data-testid="xchatEmbedRoute"]')?.shadowRoot ?? null;
    const inRoute = (s) => route()?.querySelector(s) ?? null;
    const messages = () => (read(document, path).items ?? []).filter((i) => i.kind === "message");
    // X's markup names no conversation, but each message id is one conversation's own.
    const known = new Set(${JSON.stringify(known)});
    const showsIt = () => {
      const ids = messages().map((m) => m.id);
      return known.size === 0 ? ids.length === 0 : ids.some((id) => known.has(id));
    };
    const field = inRoute('[data-testid="dm-composer-textarea"]');
    if (location.pathname !== path || !${mine} || !field || !showsIt()) return null;
    const box = field.closest('[data-testid="dm-composer-container"]') ?? route();
    // Every press is for this composer, still in X's route, on the conversation the user wrote in.
    const ours = () => location.pathname === path && ${mine} && field.isConnected && !!route()?.contains(field) && showsIt();
    const replyBar = '[data-testid="dm-composer-reply-bar"]';
    const editMode = '[data-testid="dm-composer-edit-mode"]';
    // Whatever X's composer holds already (text, a reply, an edit) is the user's own, in X.
    if (field.value !== "" || inRoute(replyBar + ", " + editMode)) return { status: "draft", id: null };
    // React keeps the field's value itself: its native setter and an input event are a keystroke.
    const type = (value) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // Stopping short, the click takes back what it did to X's composer, while it is still this one.
    const back = () => {
      if (!ours()) return null;
      inRoute('[data-testid="dm-composer-discard-edit-button"]')?.click();
      [...(inRoute(replyBar)?.querySelectorAll("button") ?? [])].at(-1)?.click();
      if (field.value !== "") type("");
      return null;
    };
    const pick = async (icon, shows) => {
      const shown = await menu();
      const row = shown?.rows.find((r) => r.querySelector('svg[data-icon="' + icon + '"]'));
      if (!ours()) return null;
      if (!row) return (shown?.more.click(), null);
      row.click();
      return wait(() => inRoute(shows));
    };
    if (${to.reply !== undefined}) {
      const reply = (await hover()) && find(testid("message-reply-button-"));
      if (!ours()) return null;
      reply?.click();
      if (!(reply ? await wait(() => inRoute(replyBar)) : await pick("icon-reply-arrow", replyBar))) return back();
    }
    if (${to.edit !== undefined} && !(await pick("icon-pencil-stroke", editMode))) return back();
    const before = new Set(messages().map((m) => m.id));
    if (!ours()) return back();
    type(text);
    const send = await wait(() => {
      const button = box.querySelector('[data-testid="dm-composer-send-button"]');
      return button && !button.disabled ? button : null;
    });
    if (!send || !ours()) return back();
    send.click();
    // X's answer, pinned once: the edited message, or the first new one of the user's with this text.
    const id = ${JSON.stringify(to.edit ?? null)} ?? (await wait(() => messages().find((m) => m.mine && !before.has(m.id) && squash(m.text) === squash(text))?.id, 100));
    if (!id) return { status: "pending", id: null };
    const mark = () => {
      const m = messages().find((x) => x.id === id);
      return m?.status === "failed" ? "failed" : m?.status === "sent" && squash(m.text) === squash(text) ? "sent" : null;
    };
    return { status: (await wait(mark, 150)) ?? "pending", id };
  })()`,
        asking(),
        () => {},
      ),
    ),
  );

/**
 * Answers X's message request on conversation `path` for the user's click with X's own Accept, or
 * its Delete, whose confirm shows over the main area for the user to answer. Null when X asks
 * nothing there.
 */
export const xChatRequest = async (
  path: string,
  answer: "accept" | "delete",
  over: (shown: boolean) => void,
) => {
  const done = await xPressOver(
    (mine) => `(async () => {
    ${IN_CHAT}
    const button = find(${JSON.stringify(`[data-testid="dm-message-request-${answer}-button"]`)});
    if (location.pathname !== ${JSON.stringify(path)} || !button || !${mine}) return null;
    button.click();
    await new Promise((r) => setTimeout(r, 300));
    return (await wait(asks, 5)) ? "over" : "done";
  })()`,
    asking(),
    over,
  );
  return done === "over" || done === "done" || done === "cancelled" ? done : null;
};

/**
 * X's own New message on its inbox, for the user's click: X's dialog to start a chat or a group
 * shows over the main area until the user is done with it (true), or moves on first (false).
 * Null when X drew none.
 */
export const xChatNew = (over: (shown: boolean) => void) =>
  xPressOver(
    (mine) => `(async () => {
    ${IN_CHAT}
    const button = await wait(() => location.pathname === "/i/chat" && find('[data-testid="dm-new-chat-button"]'), 40);
    if (!button || !${mine}) return null;
    button.click();
    return (await wait(asks, 20)) ? "over" : null;
  })()`,
    asking(),
    over,
  ).then((answer) => (answer === "over" ? true : answer === "cancelled" ? false : null));

/**
 * X's own page about conversation `path`, opened as X's More (or its title) opens it for the
 * user's click: its people, nickname, disappearing messages, calls, safety number, block and
 * delete are X's to answer, over the main area while X shows it. True once the user is done
 * there, false when they moved on first, null when X drew none.
 */
export const xChatInfo = (path: string, over: (shown: boolean) => void) =>
  xPressOver(
    (mine) => `(async () => {
    ${IN_CHAT}
    const button = find('[data-testid="dm-conversation-more-button"]') ?? find('[data-testid="dm-conversation-username"]');
    if (location.pathname !== ${JSON.stringify(path)} || !button || !${mine}) return null;
    button.click();
    return (await wait(() => location.pathname.startsWith(${JSON.stringify(`${path}/info`)}) || asks(), 20)) ? "over" : null;
  })()`,
    asking(`${path}/info`),
    over,
  ).then((answer) => (answer === "over" ? true : answer === "cancelled" ? false : null));
