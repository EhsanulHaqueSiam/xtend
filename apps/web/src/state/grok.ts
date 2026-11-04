import * as Atom from "effect/reactivity/Atom";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { xGo, xPressOver, xRun, xRunHeld } from "./x";

/**
 * X's Grok through X's own page (bundle.GrokXWeb talks to grok.com, not X's GraphQL): read from
 * what X's page draws, written only through X's own controls for the user's click. What it reads
 * stays in this module's atoms: never an engine batch, the service, a log or the bench.
 */

const Run = Schema.Struct({
  text: Schema.String,
  bold: Schema.Boolean,
  italic: Schema.Boolean,
  code: Schema.Boolean,
  href: Schema.NullOr(Schema.String),
});
export type GrokRun = typeof Run.Type;

/** One block of an answer as X's markdown draws it, or one of X's own lines under it. */
const Block = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("p"), runs: Schema.Array(Run) }),
  Schema.Struct({ kind: Schema.Literal("h"), level: Schema.Number, runs: Schema.Array(Run) }),
  Schema.Struct({
    kind: Schema.Literal("li"),
    ordered: Schema.Boolean,
    depth: Schema.Number,
    runs: Schema.Array(Run),
  }),
  Schema.Struct({ kind: Schema.Literal("quote"), runs: Schema.Array(Run) }),
  Schema.Struct({ kind: Schema.Literal("code"), lang: Schema.String, text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("table"),
    head: Schema.Boolean,
    rows: Schema.Array(Schema.Array(Schema.Array(Run))),
  }),
  Schema.Struct({ kind: Schema.Literal("hr") }),
  Schema.Struct({ kind: Schema.Literal("img"), src: Schema.String, alt: Schema.String }),
  /** X's own status line (Stopped, a usage limit, its upsell), with X's link when it has one. */
  Schema.Struct({
    kind: Schema.Literal("note"),
    text: Schema.String,
    link: Schema.NullOr(Schema.Struct({ label: Schema.String, href: Schema.String })),
  }),
]);
export type GrokBlock = typeof Block.Type;

const Answer = Schema.Struct({
  /** X's id for the answer (`data-quotable-message`). */
  id: Schema.String,
  /** X's thinking line, as drawn: "Thinking", a step, "Thought for 14s". */
  trace: Schema.NullOr(Schema.String),
  blocks: Schema.Array(Block),
  /** X's sources pill ("5 sources"). */
  sources: Schema.NullOr(Schema.String),
  /** X drew its actions under it: the answer is complete. */
  done: Schema.Boolean,
  feedback: Schema.NullOr(Schema.Literals(["up", "down"])),
  /** X offers Regenerate on it now. */
  regenerate: Schema.Boolean,
});
export type GrokAnswer = typeof Answer.Type;

const Turn = Schema.Struct({
  /** X's turn id (`data-turn-id`). */
  id: Schema.String,
  /** What the user asked, as X shows it. */
  user: Schema.NullOr(Schema.String),
  answer: Schema.NullOr(Answer),
});

const HistoryRow = Schema.Struct({
  /** X's conversation id, from its row's link (`/i/grok/c/<id>`). */
  id: Schema.String,
  title: Schema.String,
  /** X's group heading over it: Pinned, Today, Yesterday, Last 7 days, Older. */
  group: Schema.String,
  /** X's age, as drawn ("2 hours ago"). */
  age: Schema.String,
  pinned: Schema.Boolean,
  /** X marks it Current: the conversation its page shows. */
  current: Schema.Boolean,
});
export type GrokHistoryRow = typeof HistoryRow.Type;

const History = Schema.Struct({
  rows: Schema.Array(HistoryRow),
  /** X's line in place of rows: loading, none yet, none found, failed. */
  status: Schema.NullOr(Schema.String),
  /** X has more to load past its last row. */
  more: Schema.Boolean,
  /** X draws its Chats and Media tabs (behind X's switch for history media). */
  media: Schema.Boolean,
});

/** One look at X's Grok page. A null part is one X does not draw now. */
const GrokRead = Schema.Struct({
  path: Schema.String,
  /**
   * "xweb": X draws its Grok page Xtend reads. "other": X draws a Grok page Xtend does not read
   * (X's older client, its account link prompt). Null: X is not there or still loading.
   */
  page: Schema.NullOr(Schema.Literals(["xweb", "other"])),
  turns: Schema.NullOr(Schema.Array(Turn)),
  /** X's suggested follow-ups under the last answer. */
  followUps: Schema.Array(Schema.String),
  /** X's alert over its composer ("Grok lost its connection. Please try again."). */
  alert: Schema.NullOr(Schema.String),
  composer: Schema.NullOr(
    Schema.Struct({
      placeholder: Schema.String,
      /** What X's field holds now. */
      text: Schema.String,
      disabled: Schema.Boolean,
      /** X is answering: its Stop shows. */
      busy: Schema.Boolean,
      /** X's chip while it answers: Quick Answer or Think Harder. */
      steer: Schema.NullOr(Schema.Literals(["quick", "harder"])),
    }),
  ),
  /** The model X's menu shows picked. */
  model: Schema.NullOr(Schema.String),
  /** X's Private toggle, drawn on a new chat only. */
  private: Schema.NullOr(Schema.Boolean),
  /** X draws its New chat: a conversation is open. */
  conversation: Schema.Boolean,
  /** X's conversation id for the page, from its path or its `conversation` query; null on a new chat. */
  chat: Schema.NullOr(Schema.String),
});
export type GrokRead = typeof GrokRead.Type;

/**
 * What X's Grok page draws at `path`, by X's own markup. Runs in X's page as its own source
 * (`readGrok.toString()`), so it uses nothing outside itself.
 */
export function readGrok(doc: Document, path: string): GrokRead {
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
  const icon = (el: Element, name: string) => el.querySelector(`svg[data-icon="${name}"]`) !== null;
  const onGrok = path === "/i/grok" || path.startsWith("/i/grok/");
  // X's page draws its own Grok; X's drawer, when X leaves it in the page, draws another.
  const page_ = (el: Element) => !el.closest('[data-testid="GrokDrawer"]');
  const composer = [...doc.querySelectorAll("fieldset[data-grok-composer]")].find(page_) ?? null;
  const field = composer?.querySelector<HTMLTextAreaElement | HTMLElement>(
    'textarea, [contenteditable="true"]',
  );
  const page = !onGrok
    ? null
    : composer !== null
      ? "xweb"
      : doc.querySelector('main textarea, main [contenteditable="true"], main [role="textbox"]')
        ? "other"
        : null;
  // X's inline words with their marks, up to `block`: bold, italic, code and links.
  const runs = (block: Element, skip: (el: Element) => boolean = () => false): Array<GrokRun> => {
    const out: Array<GrokRun> = [];
    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        const value = node.textContent ?? "";
        if (value === "") return;
        let bold = false;
        let italic = false;
        let code = false;
        let href: string | null = null;
        for (let el = node.parentElement; el !== null && el !== block; el = el.parentElement) {
          const tag = el.tagName;
          if (tag === "STRONG" || tag === "B") bold = true;
          if (tag === "EM" || tag === "I") italic = true;
          if (tag === "CODE") code = true;
          // Resolved as X's page resolves it: X's own paths become x.com links.
          if (tag === "A" && href === null && el.hasAttribute("href"))
            href = (el as HTMLAnchorElement).href;
        }
        const last = out.at(-1);
        if (
          last !== undefined &&
          last.bold === bold &&
          last.italic === italic &&
          last.code === code &&
          last.href === href
        )
          out[out.length - 1] = { ...last, text: last.text + value };
        else out.push({ text: value, bold, italic, code, href });
        return;
      }
      if (!(node instanceof Element) || skip(node)) return;
      if (node.tagName === "BUTTON" && node.getAttribute("data-streamdown") !== "link") return;
      if (node.tagName === "BR")
        return void out.push({ text: "\n", bold: false, italic: false, code: false, href: null });
      if (node.getAttribute("aria-hidden") === "true" || node.classList.contains("sr-only")) return;
      for (const child of node.childNodes) walk(child);
    };
    walk(block);
    return out;
  };
  // X's markdown (Streamdown) as blocks, in order.
  const blocks = (root: Element): Array<GrokBlock> => {
    const out: Array<GrokBlock> = [];
    const list = (el: Element, depth: number) => {
      for (const li of el.children) {
        if (li.tagName !== "LI") continue;
        const nested = (n: Element) => n.tagName === "UL" || n.tagName === "OL";
        out.push({ kind: "li", ordered: el.tagName === "OL", depth, runs: runs(li, nested) });
        for (const n of li.querySelectorAll(
          ":scope > ul, :scope > ol, :scope > * > ul, :scope > * > ol",
        ))
          list(n, depth + 1);
      }
    };
    const walk = (el: Element) => {
      const tag = el.tagName;
      const kind = el.getAttribute("data-streamdown");
      if (tag === "P") return void out.push({ kind: "p", runs: runs(el) });
      if (/^H[1-6]$/.test(tag))
        return void out.push({ kind: "h", level: Number(tag[1]), runs: runs(el) });
      if (tag === "UL" || tag === "OL") return list(el, 0);
      if (tag === "BLOCKQUOTE") return void out.push({ kind: "quote", runs: runs(el) });
      if (tag === "HR") return void out.push({ kind: "hr" });
      if (tag === "PRE" || kind === "code-block") {
        const code = el.querySelector("pre") ?? el;
        return void out.push({
          kind: "code",
          lang: el.querySelector("[data-language]")?.getAttribute("data-language") ?? "",
          text: code.textContent ?? "",
        });
      }
      if (tag === "TABLE") {
        const rows = [...el.querySelectorAll("tr")].map((tr) =>
          [...tr.querySelectorAll("th, td")].map((cell) => runs(cell)),
        );
        return void out.push({ kind: "table", head: el.querySelector("th") !== null, rows });
      }
      if (tag === "IMG") {
        const src = el.getAttribute("src") ?? "";
        if (src !== "") out.push({ kind: "img", src, alt: el.getAttribute("alt") ?? "" });
        return;
      }
      if (tag === "BUTTON" || el.getAttribute("aria-hidden") === "true") {
        for (const img of el.querySelectorAll("img")) walk(img);
        return;
      }
      const children = [...el.children];
      // Words with only inline marks around them are a paragraph of their own.
      if (
        children.every((c) =>
          ["SPAN", "A", "STRONG", "EM", "CODE", "B", "I", "BR"].includes(c.tagName),
        )
      ) {
        const r = runs(el);
        if (r.some((x) => x.text.trim() !== "")) out.push({ kind: "p", runs: r });
        return;
      }
      for (const child of children) walk(child);
    };
    walk(root);
    return out;
  };
  // X's status lines (a limit, Stopped, a warning), with the link X gives (Upgrade).
  const note = (el: Element): GrokBlock => {
    const link = el.querySelector("a[href]");
    const words = [...el.querySelectorAll("p")].map((p) => text(p)).filter((w) => w !== "");
    return {
      kind: "note",
      text: words.length > 0 ? words.join("\n") : text(el),
      link: link === null ? null : { label: text(link), href: (link as HTMLAnchorElement).href },
    };
  };
  const answer = (el: Element): GrokAnswer => {
    const column = el.firstElementChild;
    let trace: string | null = null;
    let sources: string | null = null;
    const out: Array<GrokBlock> = [];
    for (const part of column?.children ?? []) {
      // X's sources pill: a button of its own, its favicons then "N sources".
      if (part.tagName === "BUTTON") {
        sources = text(part.querySelector(".truncate") ?? part);
        continue;
      }
      if (part.matches('[role="status"]') || part.querySelector(':scope > p[role="status"]')) {
        out.push(note(part));
        continue;
      }
      const thinking = part.querySelector('button[aria-expanded], [role="status"][aria-label]');
      if (thinking !== null && part.querySelector("p, li, pre, table, h1, h2, h3, h4") === null) {
        trace = text(thinking) || trace;
        continue;
      }
      if (part.tagName === "P") {
        out.push({ kind: "p", runs: runs(part) });
        continue;
      }
      // X's image slots: each image (opened from its own button), or X's "Generating image…".
      if (
        part.querySelector('img, [role="status"]') !== null &&
        part.querySelector("p, li, pre, table, h1, h2, h3") === null
      ) {
        for (const slot of part.querySelectorAll('img, [role="status"]'))
          out.push(
            slot.tagName === "IMG"
              ? {
                  kind: "img",
                  src: (slot as HTMLImageElement).currentSrc || (slot.getAttribute("src") ?? ""),
                  alt: slot.getAttribute("alt") ?? "",
                }
              : { kind: "note", text: text(slot), link: null },
          );
        continue;
      }
      out.push(...blocks(part));
    }
    const actions = [...el.querySelectorAll(":scope > div button, :scope > button")].filter(
      (b) => !column?.contains(b),
    );
    const pressed = actions.find((b) => b.getAttribute("aria-pressed") === "true");
    const regenerate = actions.find((b) => icon(b, "icon-reload"));
    return {
      id: el.getAttribute("data-quotable-message") ?? "",
      trace,
      blocks: out,
      sources,
      done: actions.some((b) => b.hasAttribute("aria-pressed")),
      feedback:
        pressed === undefined
          ? null
          : icon(pressed, "icon-thumbs-up-fill") || icon(pressed, "icon-thumbs-up")
            ? "up"
            : "down",
      regenerate: regenerate !== undefined && !(regenerate as HTMLButtonElement).disabled,
    };
  };
  const region = [...doc.querySelectorAll('[role="region"]')].find(page_) ?? null;
  const turns = [...(region?.querySelectorAll("[data-turn-id]") ?? [])].map((t) => {
    const user = t.querySelector('[class~="group/user"] .whitespace-pre-wrap');
    const reply = t.querySelector("[data-quotable-message]");
    return {
      id: t.getAttribute("data-turn-id") ?? "",
      user: user === null ? null : (user.textContent ?? "").trim(),
      answer: reply === null ? null : answer(reply),
    };
  });
  // X's follow-ups: buttons with its arrow, under the last answer.
  const followUps = [...(region?.querySelectorAll("button") ?? [])]
    .filter((b) => b.querySelector('path[d^="M15 10l5 5-5 5"]') !== null)
    .map((b) => text(b));
  const buttons = [...(composer?.querySelectorAll("button") ?? [])];
  const steer = composer?.querySelector('[class~="group/steer"] button') ?? null;
  const menus = buttons.filter((b) => b.getAttribute("aria-haspopup") === "menu");
  // X's Grok header sits in its column; X's own nav (with its Grok link) lies outside it.
  const head = doc.querySelector('[data-testid="primaryColumn"]') ?? doc.querySelector("main");
  const privacy =
    [...(head?.querySelectorAll("[aria-pressed]") ?? [])].find(
      (b) => !b.closest('[role="region"], fieldset[data-grok-composer]'),
    ) ?? null;
  return {
    path,
    page,
    turns: page === "xweb" ? turns : null,
    followUps,
    alert: text(doc.querySelector('[role="alert"]')) || null,
    composer:
      composer === null || field == null
        ? null
        : {
            placeholder:
              field.getAttribute("placeholder") ?? field.getAttribute("aria-label") ?? "",
            text: field instanceof HTMLTextAreaElement ? field.value : (field.textContent ?? ""),
            disabled: (composer as HTMLFieldSetElement).disabled,
            busy: buttons.some((b) => icon(b, "icon-player-stop")),
            steer: steer === null ? null : icon(steer, "icon-style=lightbulb") ? "harder" : "quick",
          },
    model: menus.length === 0 ? null : text(menus.at(-1)) || null,
    private:
      page === "xweb" && privacy !== null ? privacy.getAttribute("aria-pressed") === "true" : null,
    conversation: head?.querySelector('a[href="/i/grok"]') != null,
    chat: path.startsWith("/i/grok/c/")
      ? decodeURIComponent(path.slice("/i/grok/c/".length))
      : new URLSearchParams(doc.location?.search ?? "").get("conversation"),
  };
}

/** The Grok screen's copy of X's Grok page; in memory only, so an account switch (a new window) drops it. */
export interface GrokState {
  readonly read: GrokRead | null;
  /** X's history as last read from its own panel, with the search it was read for. */
  readonly history: (typeof History.Type & { readonly query: string }) | null;
}

export const grokAtom = Atom.make<GrokState>({ read: null, history: null }).pipe(Atom.keepAlive);

/**
 * What the user types into Grok's box, and the one send in flight: its text stays until X shows
 * it asked, in X's own words, or X refused it. In memory like `grokAtom`.
 */
export interface GrokWrite {
  readonly draft: string;
  readonly send: {
    readonly text: string;
    /** This attempt, so only it ends itself. */
    readonly id: number;
    /** X's page and conversation it was sent on, the turns X drew there then, and X's alert. */
    readonly path: string;
    readonly chat: string | null;
    readonly before: ReadonlyArray<string>;
    readonly alert: string | null;
  } | null;
}
export const grokWriteAtom = Atom.make<GrokWrite>({ draft: "", send: null }).pipe(Atom.keepAlive);

/**
 * Whether X's `turns` are the send's own conversation grown by its question: every turn X drew
 * when it was sent, then one more, the question. Runs in X's page too, as its own source.
 */
function askedIn(
  before: ReadonlyArray<string>,
  turns: ReadonlyArray<{ readonly id: string; readonly user: string | null }>,
  text: string,
) {
  const same = (a: string, b: string) =>
    a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
  const last = turns.at(-1);
  return (
    turns.length === before.length + 1 &&
    before.every((id) => turns.some((t) => t.id === id)) &&
    last !== undefined &&
    !before.includes(last.id) &&
    last.user !== null &&
    same(last.user, text)
  );
}

/**
 * What became of the send in flight, by X's page `read`: "shown" once X draws it on its own
 * conversation, "failed" once X refused it (an alert during this attempt, another page or
 * conversation), null meanwhile.
 */
const sendSettled = ({ send }: GrokWrite, read: GrokRead) => {
  if (send === null) return null;
  if (read.path !== send.path || (send.chat !== null && read.chat !== send.chat)) return "failed";
  if (read.turns === null) return null;
  const ids = new Set(read.turns.map((t) => t.id));
  if (!send.before.every((id) => ids.has(id))) return "failed";
  if (askedIn(send.before, read.turns, send.text)) return "shown";
  return read.alert !== null && read.alert !== send.alert ? "failed" : null;
};

/**
 * `write` after X's page `read`: the send in flight ends once settled, its words kept when X
 * refused it. An alert X showed when it was sent counts once X clears it: shown again, it ends it.
 */
export const settleSend = (write: GrokWrite, read: GrokRead): GrokWrite => {
  const settled = sendSettled(write, read);
  if (settled !== null) return { draft: settled === "shown" ? "" : write.draft, send: null };
  const send = write.send;
  if (send !== null && send.alert !== null && read.alert === null && read.path === send.path)
    return { ...write, send: { ...send, alert: null } };
  return write;
};

/** An answer as plain text, for Copy and Draft a post: X's markdown without its marks. */
export const answerText = (answer: GrokAnswer) =>
  answer.blocks
    .flatMap((b) => {
      const line = (runs: ReadonlyArray<GrokRun>) =>
        runs
          .map((r) => r.text)
          .join("")
          .trim();
      switch (b.kind) {
        case "p":
        case "h":
        case "quote":
          return [line(b.runs)];
        case "li":
          return [`${"  ".repeat(b.depth)}${b.ordered ? "-" : "•"} ${line(b.runs)}`];
        case "code":
          return [b.text.trimEnd()];
        case "table":
          return b.rows.map((row) => row.map(line).join("\t"));
        case "note":
          return [];
        default:
          return [];
      }
    })
    .filter((l) => l !== "")
    .join("\n\n");

/** The X handles an answer names, by X's profile links and @handles, in order, once each. */
export const namedHandles = (answer: GrokAnswer): ReadonlyArray<string> => {
  const seen = new Map<string, string>();
  const add = (handle: string) => {
    const key = handle.toLowerCase();
    if (!seen.has(key) && !["i", "home", "search", "explore", "grok"].includes(key))
      seen.set(key, handle);
  };
  for (const b of answer.blocks) {
    const runs =
      b.kind === "p" || b.kind === "h" || b.kind === "li" || b.kind === "quote"
        ? b.runs
        : b.kind === "table"
          ? b.rows.flat(2)
          : [];
    for (const r of runs) {
      const profile = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/.exec(r.href ?? "");
      if (profile?.[1] !== undefined) add(profile[1]);
      for (const m of r.text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9_]{1,15})\b/g)) add(m[1]!);
    }
  }
  return [...seen.values()];
};

const decodeRead = Schema.decodeUnknownOption(
  Schema.Struct({ hash: Schema.String, read: GrokRead }),
);

/**
 * The next look at X's Grok page that differs from the one hashed `last`: X's page watches its
 * document and answers a moment after it changes (while Grok streams, every fraction of a
 * second), or after a while with what it has. Null when the page could not answer.
 */
const nextRead = async (last: string, token: number, signal: AbortSignal) => {
  const answer = await xRunHeld(
    `(async () => {
    const read = ${readGrok.toString()};
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const look = () => { const read_ = read(document, location.pathname); return { hash: hash(JSON.stringify(read_)), read: read_ }; };
    const now = look();
    if (now.hash !== ${JSON.stringify(last)}) return now;
    return new Promise((done) => {
      let soon;
      const end = () => {
        observer.disconnect(); clearTimeout(soon); clearTimeout(cap);
        if (window.__xtendGrokWatch?.token === ${token}) delete window.__xtendGrokWatch;
      };
      const finish = () => { end(); done(look()); };
      // X streams an answer as a run of changes: one look a moment after the first, not after the last.
      const observer = new MutationObserver(() => {
        if (soon === undefined) soon = setTimeout(() => { soon = undefined; if (look().hash !== ${JSON.stringify(last)}) finish(); }, 150);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-pressed", "aria-expanded", "disabled", "data-turn-id"] });
      const cap = setTimeout(finish, 20000);
      window.__xtendGrokWatch = { token: ${token}, stop: () => { end(); done(null); } };
    });
  })()`,
    signal,
  );
  return Option.getOrNull(decodeRead(answer));
};

let watches = 0;

/**
 * Reads X's Grok page into `onRead` until `signal` ends it: each time X's page redraws. Only for
 * a Grok surface while it is open; a page that could not answer is asked again a second later.
 */
export const watchGrok = (signal: AbortSignal, onRead: (read: GrokRead) => void) => {
  const token = ++watches;
  signal.addEventListener(
    "abort",
    () =>
      void xRun(
        `window.__xtendGrokWatch?.token === ${token} && window.__xtendGrokWatch.stop(), true`,
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

/** X's paths a Grok surface may open: its page and its own conversation links, nothing else. */
export const isGrokPath = (path: string) => /^\/i\/grok(\/c\/[A-Za-z0-9%_-]{1,120})?$/.test(path);

/**
 * Script steps in X's page on its Grok page: X's composer and field, its header, a short wait,
 * a keystroke into a field, and X's history panel with its rows.
 */
const IN_GROK = `
    const onGrok = () => location.pathname === "/i/grok" || location.pathname.startsWith("/i/grok/");
    const wait = async (check, tries = 20) => {
      for (let i = 0; i < tries; i++) {
        const found = check();
        if (found) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      return check();
    };
    const icon = (el, name) => !!el?.querySelector('svg[data-icon="' + name + '"]');
    const composer = () => [...document.querySelectorAll("fieldset[data-grok-composer]")].find((f) => !f.closest('[data-testid="GrokDrawer"]')) ?? null;
    const field = () => composer()?.querySelector('textarea, [contenteditable="true"]') ?? null;
    const head = () => document.querySelector('[data-testid="primaryColumn"]') ?? document.querySelector("main") ?? document.createElement("div");
    // React keeps a field's value itself: its native setter and an input event are a keystroke;
    // X's rich editor takes text the way a paste or the keyboard puts it there.
    const type = (el, value) => {
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      el.focus();
      document.execCommand("selectAll", false);
      if (value === "") document.execCommand("delete", false);
      else document.execCommand("insertText", false, value);
    };
    const valueOf = (el) => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : el.textContent ?? "");
    const historyButton = () => head().querySelector('[aria-haspopup="dialog"][aria-expanded]');
    // X's History panel, or, in X's compact layout, X's History page (/i/grok/history).
    const historyPanel = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('input[type="search"]')) ?? (location.pathname === "/i/grok/history" ? document.querySelector('[data-testid="primaryColumn"] input[type="search"]')?.closest('[data-testid="primaryColumn"]') ?? null : null);
    const rowOf = (panel, id) => [...panel.querySelectorAll("li")].find((li) => li.querySelector('a[href="/i/grok/c/' + encodeURIComponent(id) + '"]')) ?? null;
    const openHistory = async () => {
      const shown = historyPanel();
      if (shown) return { panel: shown, opened: false };
      const button = historyButton();
      if (!button) return null;
      button.click();
      const panel = await wait(historyPanel, 30);
      return panel ? { panel, opened: location.pathname === "/i/grok/history" ? "page" : "panel" } : null;
    };
    // X's page goes Back to the conversation; X's panel closes from its own button.
    const closeHistory = (opened) => {
      if (opened === "page" && location.pathname === "/i/grok/history") history.back();
      else if (opened && historyPanel() && historyButton()?.getAttribute("aria-expanded") === "true") historyButton().click();
    };`;

/** X's history panel: its rows by group, its status line, and whether it has more to load. */
const READ_HISTORY = `(panel) => {
      const text = (el) => el?.textContent?.trim() ?? "";
      const rows = [];
      let group = "";
      for (const li of panel.querySelectorAll("ul > li")) {
        const heading = li.querySelector("h2");
        if (heading) { group = text(heading); continue; }
        const link = li.querySelector('a[href^="/i/grok/c/"]');
        if (!link) continue;
        const spans = [...link.children].filter((c) => c.tagName === "SPAN");
        let id = link.getAttribute("href").slice("/i/grok/c/".length);
        try { id = decodeURIComponent(id); } catch {}
        rows.push({
          id,
          title: text(spans[0]),
          group,
          age: text(li.querySelector(".grid > span")),
          pinned: !!link.querySelector('svg[data-icon="icon-pin-fill"]'),
          current: spans.length > 1,
        });
      }
      const status = [...panel.querySelectorAll('[role="status"]')].map((s) => [...s.querySelectorAll("p")].map(text).join(" ") || text(s)).filter((s) => s !== "")[0] ?? null;
      // X's sentinel past its last row, which loads its next page as it scrolls into view.
      return { rows, status, more: !!panel.querySelector("[aria-busy] .h-px"), media: panel.querySelectorAll('[role="tab"]').length > 1 };
    }`;

const decodeHistory = Schema.decodeUnknownOption(History);

/**
 * X's Grok history, read from X's own History panel, opened and closed again as a glance does:
 * searched for `query` with X's own search, and with `more`, scrolled to X's next page first.
 * Presses nothing that changes anything. Null when X draws no history there.
 */
export const xGrokHistory = async (query = "", more = false) =>
  Option.getOrNull(
    decodeHistory(
      await xRun(`(async () => {
    ${IN_GROK}
    const read = ${READ_HISTORY};
    if (!onGrok()) return null;
    const shown = await openHistory();
    if (!shown) return null;
    const { panel, opened } = shown;
    const search = panel.querySelector('input[type="search"]');
    const query = ${JSON.stringify(query)};
    if (search && search.value !== query) type(search, query);
    const busy = () => panel.querySelector('[aria-busy="true"]');
    const settled = () => !busy() && (read(panel).rows.length > 0 || read(panel).status !== null && !/…$/.test(read(panel).status));
    // X searches 200ms after the last key, then loads.
    await new Promise((r) => setTimeout(r, query === "" ? 0 : 250));
    await wait(settled, 50);
    if (${more}) {
      const before = read(panel).rows.length;
      const list = panel.querySelector("[aria-busy]");
      list?.scrollTo({ top: list.scrollHeight });
      await wait(() => read(panel).rows.length > before || !read(panel).more, 50);
    }
    const answer = read(panel);
    closeHistory(opened);
    return answer;
  })()`),
    ),
  );

/** What X still asks of the user on its Grok page: a dialog other than its history, or its own page elsewhere. */
const asking = `(() => {
    const up = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.querySelector('input[type="search"]'));
    return up.length > 0 || !(location.pathname === "/i/grok" || location.pathname.startsWith("/i/grok/"));
  })()`;

/**
 * Presses X's own control on history row `id` for the user's click, in X's History panel searched
 * for `query`, as the rail lists it: Pin or Unpin, Rename with `title` typed into X's own field and
 * X's Save, or Delete and X's own confirm beside it. "done" once X's row shows it; null when X
 * draws no such row or control.
 */
export const xGrokHistoryPress = async (
  id: string,
  action: "pin" | "unpin" | "rename" | "delete",
  title = "",
  query = "",
) => {
  const answer = await xPressOver(
    (mine) => `(async () => {
    ${IN_GROK}
    const read = ${READ_HISTORY};
    const id = ${JSON.stringify(id)};
    if (!onGrok() || !${mine}) return null;
    const shown = await openHistory();
    if (!shown) return null;
    const { panel, opened } = shown;
    // The row as the rail lists it, under the rail's own search: X's search holds the same query.
    const search = panel.querySelector('input[type="search"]');
    const query = ${JSON.stringify(query)};
    if (search && search.value !== query) { type(search, query); await new Promise((r) => setTimeout(r, 250)); }
    const row = await wait(() => rowOf(panel, id), 30);
    const has = (name) => [...(row?.querySelectorAll("button") ?? [])].find((b) => icon(b, name));
    const done = (answer) => (closeHistory(opened), answer);
    if (!row || !${mine}) return done(null);
    const was = read(panel).rows.find((r) => r.id === id);
    if (${JSON.stringify(action)} === "pin" || ${JSON.stringify(action)} === "unpin") {
      const button = has(${JSON.stringify(action === "pin" ? "icon-pin" : "icon-pin-off")});
      if (!button) return done(null);
      button.click();
      const turned = await wait(() => read(panel).rows.find((r) => r.id === id)?.pinned === ${action === "pin"}, 50);
      return done(turned ? "done" : null);
    }
    if (${JSON.stringify(action)} === "rename") {
      const edit = has("icon-edit-line");
      if (!edit) return done(null);
      edit.click();
      const input = await wait(() => row.querySelector("input"));
      if (!input || !${mine}) return done(null);
      type(input, ${JSON.stringify(title)});
      const save = [...row.querySelectorAll("button")].at(-1);
      if (!save) return done(null);
      save.click();
      // Under a search, the new title may no longer match: X then lists the row no more.
      const renamed = await wait(() => {
        const now = read(panel).rows.find((r) => r.id === id);
        return now === undefined ? query !== "" : now.title === ${JSON.stringify(title.trim())};
      }, 50);
      return done(renamed ? "done" : null);
    }
    const trash = has("icon-trashcan");
    if (!trash || !was) return done(null);
    trash.click();
    // X's own confirm takes the row's place: Cancel, then Delete.
    const confirm = await wait(() => { const b = [...row.querySelectorAll("button")]; return !has("icon-trashcan") && b.length === 2 ? b[1] : null; });
    if (!confirm || !${mine}) return done(null);
    confirm.click();
    const gone = await wait(() => !read(panel).rows.some((r) => r.id === id), 50);
    return done(gone ? "done" : null);
  })()`,
    asking,
    () => {},
  );
  return answer === "done" ? answer : null;
};

const Model = Schema.Struct({
  title: Schema.String,
  badge: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  /** "selected" and "select" pick it; "upgrade" opens X's upsell; "disabled" is X's greyed row. */
  state: Schema.Literals(["selected", "select", "upgrade", "disabled"]),
  /** X lists it under its Models submenu. */
  more: Schema.Boolean,
});
export type GrokModel = typeof Model.Type;
const decodeModels = Schema.decodeUnknownOption(
  Schema.Union([Schema.Array(Model), Schema.Struct({ failed: Schema.String })]),
);

/** Script steps on X's model menu: open it from X's own trigger, read its rows, open its submenu. */
const IN_MODELS = `
    const trigger = () => [...(composer()?.querySelectorAll('button[aria-haspopup="menu"]') ?? [])].at(-1) ?? null;
    const menus = () => [...document.querySelectorAll('[role="menu"]')];
    const rowsOf = (menu, more) => [...menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].filter((r) => r.closest('[role="menu"]') === menu).map((r) => {
      const body = r.querySelector("span.flex-col") ?? r;
      const [line, about] = [...body.children];
      const badge = line?.querySelector("span");
      const title = (line ? [...line.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : r.textContent).trim();
      return {
        el: r,
        sub: r.getAttribute("aria-haspopup") === "menu",
        row: {
          title,
          badge: badge ? badge.textContent.replace(/^\\s*•\\s*/, "").trim() || null : null,
          description: about?.textContent.trim() || null,
          state: r.getAttribute("role") === "menuitemradio" ? (r.getAttribute("aria-checked") === "true" ? "selected" : "select") : r.hasAttribute("data-disabled") || r.getAttribute("aria-disabled") === "true" ? "disabled" : "upgrade",
          more,
        },
      };
    });
    const openMenu = async () => {
      const t = trigger();
      if (!t) return null;
      if (t.getAttribute("aria-expanded") !== "true") t.click();
      return wait(() => menus()[0] ?? null);
    };
    const openMore = async (menu) => {
      const sub = rowsOf(menu, false).find((r) => r.sub);
      if (!sub) return null;
      sub.el.click();
      return wait(() => menus().find((m) => m !== menu) ?? null);
    };
    const closeMenu = () => { if (trigger()?.getAttribute("aria-expanded") === "true") trigger().click(); };`;

/**
 * X's model menu, read from X's own menu for the user's click on Xtend's: X's list as X's server
 * sent it, with X's pick, its submenu and its upgrade rows. Presses nothing: X's menu closes
 * again. `{ failed }` carries X's own words when X could not load them; null when X draws none.
 */
export const xGrokModels = async () =>
  Option.getOrNull(
    decodeModels(
      await xRun(`(async () => {
    ${IN_GROK}
    ${IN_MODELS}
    if (!onGrok()) return null;
    const menu = await openMenu();
    if (!menu) return null;
    const top = rowsOf(menu, false);
    // X's one row when its list did not load: "Failed to load models. Retry".
    if (top.length === 1 && !top[0].sub && !top[0].el.querySelector("span.flex-col")) return (closeMenu(), { failed: top[0].el.textContent.trim() });
    const sub = await openMore(menu);
    const rows = [...top.filter((r) => !r.sub), ...(sub ? rowsOf(sub, true) : [])].map((r) => r.row);
    closeMenu();
    return rows;
  })()`),
    ),
  );

/**
 * Picks model `title` in X's own menu for the user's click. An upgrade row is X's upsell: it
 * shows over the main area while X shows it. "done" once X took it; null when X lists no such row.
 */
export const xGrokPickModel = async (title: string, over: (shown: boolean) => void) => {
  const answer = await xPressOver(
    (mine) => `(async () => {
    ${IN_GROK}
    ${IN_MODELS}
    if (!onGrok() || !${mine}) return null;
    const menu = await openMenu();
    if (!menu) return null;
    const title = ${JSON.stringify(title)};
    let row = rowsOf(menu, false).find((r) => !r.sub && r.row.title === title);
    if (!row) { const sub = await openMore(menu); row = sub ? rowsOf(sub, true).find((r) => r.row.title === title) : undefined; }
    if (!row || row.row.state === "disabled" || !${mine}) return (closeMenu(), null);
    const upgrade = row.row.state === "upgrade";
    row.el.click();
    if (!upgrade) return (closeMenu(), "done");
    await new Promise((r) => setTimeout(r, 300));
    return (await wait(() => ${asking}, 10)) ? "over" : "done";
  })()`,
    asking,
    over,
  );
  return answer === "done" || answer === "over" || answer === "cancelled" ? answer : null;
};

const Sent = Schema.Struct({
  status: Schema.Literals(["sent", "pending", "draft", "busy"]),
});
const decodeSent = Schema.decodeUnknownOption(Sent);

/**
 * Asks Grok `text` for the user's click: typed into X's own composer as a keystroke does, then X's
 * own Send, on X's page at `path` only. "sent" once X shows the question in its conversation,
 * "pending" while X has not yet; "draft" when X's composer already holds something of the user's,
 * "busy" while X is still answering. Null when nothing was sent.
 */
export const xGrokSend = async (path: string, text: string) =>
  Option.getOrNull(
    decodeSent(
      await xPressOver(
        (mine) => `(async () => {
    ${IN_GROK}
    const read = ${readGrok.toString()};
    const path = ${JSON.stringify(path)};
    const text = ${JSON.stringify(text)};
    const same = (a, b) => a.replace(/\\s+/g, " ").trim() === b.replace(/\\s+/g, " ").trim();
    const box = composer();
    const input = field();
    if (location.pathname !== path || !${mine} || !box || !input || box.disabled) return null;
    const now = read(document, path);
    if (now.composer?.busy) return { status: "busy" };
    // Whatever X's composer holds already is the user's own, in X.
    if (valueOf(input).trim() !== "") return { status: "draft" };
    const pinned = () => location.pathname === path && input.isConnected && composer() === box;
    const ours = () => pinned() && ${mine};
    const before = (now.turns ?? []).map((t) => t.id);
    const chat = now.chat;
    const asked = ${askedIn.toString()};
    type(input, text);
    const send = await wait(() => {
      const buttons = [...box.querySelectorAll("button")];
      const last = buttons.at(-1);
      return last && !last.disabled && !icon(last, "icon-voice") && !icon(last, "icon-player-stop") ? last : null;
    });
    // Stopping short, the click takes back what it typed, while X's field still holds exactly that.
    if (!send || !ours()) return (pinned() && same(valueOf(input), text) && type(input, ""), null);
    send.click();
    // Only on the conversation it was sent on: X may have moved to another holding the same words.
    const shown = await wait(() => {
      if (location.pathname !== path) return false;
      const later = read(document, path);
      return (chat === null || later.chat === chat) && asked(before, later.turns ?? [], text);
    }, 100);
    return { status: shown ? "sent" : "pending" };
  })()`,
        asking,
        () => {},
      ),
    ),
  );

/**
 * X's own control on its Grok page for the user's click: Stop while it answers, its Quick Answer
 * or Think Harder chip, Regenerate or Good or Bad response on answer `id`, Private on a new chat
 * and New chat in a conversation. True once pressed; null when X draws no such control.
 */
export const xGrokPress = async (
  control: "stop" | "steer" | "private" | "new" | "regenerate" | "up" | "down",
  id = "",
) =>
  (await xPressOver(
    (mine) => `(async () => {
    ${IN_GROK}
    if (!onGrok() || !${mine}) return null;
    const control = ${JSON.stringify(control)};
    const toggles = [...head().querySelectorAll("[aria-pressed]")].filter((b) => !b.closest('[role="region"], fieldset[data-grok-composer]'));
    const answer = ${JSON.stringify(id)} === "" ? null : [...document.querySelectorAll("[data-quotable-message]")].find((a) => a.getAttribute("data-quotable-message") === ${JSON.stringify(id)}) ?? null;
    const actions = answer ? [...answer.querySelectorAll("button")].filter((b) => !answer.firstElementChild?.contains(b)) : [];
    const thumb = (up) => actions.find((b) => b.hasAttribute("aria-pressed") && (icon(b, up ? "icon-thumbs-up" : "icon-thumbs-down") || icon(b, up ? "icon-thumbs-up-fill" : "icon-thumbs-down-fill")));
    const button =
      control === "stop" ? [...(composer()?.querySelectorAll("button") ?? [])].find((b) => icon(b, "icon-player-stop"))
      : control === "steer" ? composer()?.querySelector('[class~="group/steer"] button')
      : control === "private" ? toggles[0]
      : control === "new" ? head().querySelector('a[href="/i/grok"]')
      : control === "regenerate" ? actions.find((b) => icon(b, "icon-reload") && !b.disabled)
      : thumb(control === "up");
    if (!button || !${mine}) return null;
    button.click();
    return true;
  })()`,
    asking,
    () => {},
  )) === true || null;

const decodeMedia = Schema.decodeUnknownOption(
  Schema.Struct({ images: Schema.Array(Schema.String), status: Schema.NullOr(Schema.String) }),
);

/**
 * X's Media tab in its History panel: the images X lists there (copies of what X draws), or X's
 * line in their place. X's tab is pressed and Chats pressed back before the panel closes, as a
 * glance does; nothing changes. Null when X draws no Media tab.
 */
export const xGrokMedia = async () =>
  Option.getOrNull(
    decodeMedia(
      await xRun(`(async () => {
    ${IN_GROK}
    if (!onGrok()) return null;
    const shown = await openHistory();
    if (!shown) return null;
    const { panel, opened } = shown;
    const tabs = [...panel.querySelectorAll('[role="tab"]')];
    if (tabs.length < 2) return (closeHistory(opened), null);
    tabs[1].click();
    const grid = () => panel.querySelector("ul.grid");
    const status = () => [...panel.querySelectorAll('[role="status"]')].map((s) => s.textContent.trim()).find((t) => t !== "" && !/…$/.test(t)) ?? null;
    await wait(() => grid()?.querySelector("img") || status(), 50);
    // X revokes its blobs once its panel closes: each picture is copied while X still draws it.
    const pictures = [...(grid()?.querySelectorAll("img") ?? [])];
    await wait(() => pictures.every((i) => i.complete && i.naturalWidth > 0), 30);
    const copy = (img) => {
      try {
        const k = Math.min(1, 360 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.8);
      } catch { return ""; }
    };
    const images = pictures.filter((i) => i.naturalWidth > 0).map(copy).filter((s) => s.startsWith("data:image/"));
    const answer = { images, status: images.length > 0 ? null : status() };
    tabs[0].click();
    closeHistory(opened);
    return answer;
  })()`),
    ),
  );

/** Copies of X's own Grok images, by X's page's URL for them: X draws them from blobs of its page. */
const images = new Map<string, Promise<string | null>>();

/**
 * One of X's Grok images as a picture the app page can draw: X fetches them with grok.com's
 * credentials into its page's own blob URLs, so X's page draws a copy (at most 1280px) for Xtend.
 * Null when X's page no longer holds it.
 */
export const xGrokImage = (src: string) => {
  const known = images.get(src);
  if (known !== undefined) return known;
  const copy = xRun(`(async () => {
    const src = ${JSON.stringify(src)};
    if (!src.startsWith("blob:") && !src.startsWith("https://assets.grok.com/")) return null;
    try {
      const shown = [...document.images].find((i) => (i.currentSrc || i.src) === src && i.complete && i.naturalWidth > 0);
      const picture = shown ?? (await createImageBitmap(await (await fetch(src)).blob()));
      const w = shown ? shown.naturalWidth : picture.width;
      const h = shown ? shown.naturalHeight : picture.height;
      const k = Math.min(1, 1280 / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.85);
    } catch { return null; }
  })()`).then((url) => (typeof url === "string" && url.startsWith("data:image/") ? url : null));
  images.set(src, copy);
  // A copy X's page could not make is asked again the next time it shows.
  void copy.then((url) => url === null && images.delete(src));
  return copy;
};

/**
 * Presses X's own Grok button on the post ("Grok actions", its first row when X offers more) for
 * the user's click: X sends its analysis and opens its drawer or Grok page, and the engine then
 * shows X's Grok page, as X's drawer's own full page button does. Null when X draws no such button.
 */
export const xGrokExplain = async (post: { readonly postId: string; readonly handle: string }) => {
  if (!/^\d{1,25}$/.test(post.postId) || !/^[A-Za-z0-9_]{1,15}$/.test(post.handle)) return null;
  const press = (tries: number) =>
    xPressOver(
      (mine) => `(async () => {
    ${IN_GROK}
    for (let i = 0; i < ${tries} && !document.querySelector("article"); i++) await new Promise((r) => setTimeout(r, 100));
    const own = () => document.querySelector('article a[href$="/status/${post.postId}"] time, article a[href$="/status/${post.postId}/history"] time')?.closest("article") ?? null;
    const button = await wait(() => own()?.querySelector('[aria-label="Grok actions"]'), ${tries});
    if (!button || !${mine}) return null;
    button.click();
    // X's menu when it offers more than one Grok action: Explain this post is its first row.
    const menu = await wait(() => document.querySelector('[role="menu"] [role="menuitem"]') || onGrok() || document.querySelector('[data-testid="GrokDrawer"] fieldset[data-grok-composer]'), 20);
    if (menu instanceof Element && menu.getAttribute("role") === "menuitem") menu.click();
    return (await wait(() => onGrok() || !!document.querySelector('[data-testid="GrokDrawer"] fieldset[data-grok-composer]'), 30)) ? "done" : null;
  })()`,
      asking,
      () => {},
    );
  let answer = await press(10);
  if (answer !== "done") {
    // Not on the engine page: on the post's own page, through X's router.
    await xGo(`https://x.com/${post.handle}/status/${post.postId}`);
    answer = await press(100);
  }
  if (answer !== "done") return null;
  if ((await xRun(`location.pathname.startsWith("/i/grok")`)) !== true)
    await xGo("https://x.com/i/grok");
  return answer;
};

/**
 * X's Grok docked beside an X screen, as X's own drawer docks: where the engine was when it opened
 * (it goes back there when the drawer closes) and the post it was opened on. Null when closed.
 */
export const grokDrawerAtom = Atom.make<{
  readonly from: string;
  readonly post: { readonly postId: string; readonly handle: string } | null;
} | null>(null);

/**
 * X's Grok page with a new chat, for the user's click on Xtend's "Ask Grok": the engine goes to
 * X's Grok page and presses X's own New chat there when X shows a conversation. True once X shows
 * a new chat; null when X drew no Grok page.
 */
export const xGrokOpenNew = async () => {
  await xGo("https://x.com/i/grok");
  return (
    (await xPressOver(
      (mine) => `(async () => {
    ${IN_GROK}
    if (!(await wait(() => onGrok() && composer(), 50)) || !${mine}) return null;
    const fresh = head().querySelector('a[href="/i/grok"]');
    if (fresh) fresh.click();
    return (await wait(() => !head().querySelector('a[href="/i/grok"]'), 30)) ? true : null;
  })()`,
      asking,
      () => {},
    )) === true || null
  );
};

/** Takes the engine from X's Grok page back to `from`, once a docked Grok closes, if X is still there. */
export const xGrokLeave = async (from: string) => {
  if ((await xRun(`location.pathname.startsWith("/i/grok")`)) !== true) return;
  if (!/^https:\/\/x\.com\/i\/grok/.test(from)) await xGo(from);
};
