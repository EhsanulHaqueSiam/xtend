import * as Atom from "effect/reactivity/Atom";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { xGo, xPressOver, xRun, xRunHeld } from "./x";

/**
 * X's settings through X's own pages: the open page is read off X's page in the engine as X draws
 * it (its words, in the account's language), and each change presses X's own control there for
 * the user's click, one at a time. Only the page the user opened is read, never all of them.
 */

const Text = Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String });
const Heading = Schema.Struct({ kind: Schema.Literal("heading"), text: Schema.String });
const Link = Schema.Struct({
  kind: Schema.Literal("link"),
  label: Schema.String,
  hint: Schema.String,
  /** X's own href: a path on x.com, or a full URL for a page off X (its Help Center). */
  href: Schema.String,
  external: Schema.Boolean,
});
const Check = Schema.Struct({
  kind: Schema.Literal("check"),
  label: Schema.String,
  hint: Schema.String,
  checked: Schema.Boolean,
  disabled: Schema.Boolean,
  /** X draws a switch rather than a checkbox. */
  toggle: Schema.Boolean,
});
const Radio = Schema.Struct({
  kind: Schema.Literal("radio"),
  /** The radio group, by X's own label for it or its input name; radios of one group share it. */
  group: Schema.String,
  label: Schema.String,
  hint: Schema.String,
  checked: Schema.Boolean,
  disabled: Schema.Boolean,
});
const Select = Schema.Struct({
  kind: Schema.Literal("select"),
  label: Schema.String,
  value: Schema.String,
  options: Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
  disabled: Schema.Boolean,
});
const Button = Schema.Struct({ kind: Schema.Literal("button"), label: Schema.String });
/** A control Xtend does not draw (a slider): its row opens X's page. */
const Other = Schema.Struct({ kind: Schema.Literal("other"), label: Schema.String });
const XSettingsItem = Schema.Union([Text, Heading, Link, Check, Radio, Select, Button, Other]);
export type XSettingsItem = typeof XSettingsItem.Type;

/** One look at X's settings page. */
const XSettingsRead = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  items: Schema.Array(XSettingsItem),
  /** X asks for typing on this page (a password, a name): only X's own page takes that. */
  typing: Schema.Boolean,
  /** X is still loading what the page shows. */
  loading: Schema.Boolean,
});
export type XSettingsRead = typeof XSettingsRead.Type;

/**
 * What X's settings page draws, in X's order and markup (bundle.Settings, SettingsInternals): X's
 * inputs carry no names, so a control is known by its place and label. `nodes` gets each item's
 * element, for a press. `path` is X's page's own. Runs in X's page as its own source, so it uses nothing outside itself.
 */
export function readXSettings(doc: Document, path: string, nodes?: Array<Element>): XSettingsRead {
  // A settings dialog (Search settings on a wide window) over the page, else the page's detail.
  const box =
    doc.querySelector('[aria-labelledby="modal-header"]') ??
    doc.querySelector('[aria-labelledby="detail-header"]') ??
    doc.querySelector("main");
  const items: Array<XSettingsItem> = [];
  const read = { path, title: "", items, typing: false, loading: false };
  if (box === null) return { ...read, loading: true };
  const title = box.querySelector("#modal-header, #detail-header, h2");
  read.title = title?.textContent?.trim() ?? "";
  // The title's block carries X's back button and the "@handle" line under the title.
  const header = title?.parentElement ?? null;
  const lines = (el: Element | null | undefined) =>
    ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  const byId = (id: string | null) => (id === null ? null : doc.getElementById(id));
  // The block the last text came from: pieces of one line (a bold word, a link's words) join it.
  let block: Element | null = null;
  const add = (item: XSettingsItem, node: Element) => {
    items.push(item);
    nodes?.push(node);
    block = null;
  };
  const off = (el: Element) => el.matches(":disabled, [aria-disabled='true']");
  const radio = (input: HTMLInputElement) => {
    const label = lines(byId(input.getAttribute("aria-labelledby"))).join(" ");
    add(
      {
        kind: "radio",
        group:
          input.closest('[role="radiogroup"]')?.getAttribute("aria-label") ??
          input.getAttribute("name") ??
          "",
        label:
          label !== ""
            ? label
            : (input.getAttribute("aria-label") ?? lines(input.closest("label"))[0] ?? ""),
        hint: lines(byId(input.getAttribute("aria-describedby"))).join(" "),
        checked: input.checked,
        disabled: off(input),
      },
      input,
    );
  };
  // A control's own label: X's wrapping <label>, else what it names itself by.
  const own = (el: Element) =>
    lines(el.closest("label"))[0] ??
    el.getAttribute("aria-label") ??
    lines(byId(el.getAttribute("aria-labelledby")))[0] ??
    "";
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node.textContent?.trim() ?? "";
      if (text === "") return;
      const at = node.parentElement?.closest("[dir]") ?? node.parentElement;
      const last = items.at(-1);
      if (last?.kind === "text" && at !== null && at === block)
        items[items.length - 1] = { ...last, text: `${last.text} ${text}` };
      else {
        add({ kind: "text", text }, node.parentElement ?? box);
        block = at;
      }
      return;
    }
    if (!(node instanceof Element)) return;
    const skip = 'svg, style, script, [aria-hidden="true"], [hidden], [data-testid="app-bar-back"]';
    if (node === header || node.matches(skip)) return;
    if (node.matches('[role="progressbar"]')) {
      read.loading = true;
      return;
    }
    if (
      node.matches(
        'textarea, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="hidden"])',
      )
    ) {
      read.typing = true;
      return;
    }
    if (node.matches('[role="heading"]'))
      return add({ kind: "heading", text: lines(node).join(" ") }, node);
    if (node.matches("a[href]")) {
      const [label = "", ...hint] = lines(node);
      const href = node.getAttribute("href") ?? "";
      const external = /^https?:/.test(href) && new URL(href).host !== doc.location?.host;
      return add({ kind: "link", label, hint: hint.join(" "), href, external }, node);
    }
    if (node.matches("label")) {
      const input = node.querySelector('input[type="checkbox"]');
      if (input instanceof HTMLInputElement) {
        const [label = "", ...hint] = lines(node);
        return add(
          {
            kind: "check",
            label,
            hint: hint.join(" "),
            checked: input.checked,
            disabled: off(input),
            toggle: input.getAttribute("role") === "switch",
          },
          input,
        );
      }
      const radios = node.querySelectorAll('input[type="radio"]');
      if (radios.length > 0) {
        for (const r of radios) radio(r as HTMLInputElement);
        return;
      }
    }
    if (node instanceof HTMLInputElement && node.type === "radio") return radio(node);
    if (node instanceof HTMLInputElement && node.type === "checkbox")
      return add(
        {
          kind: "check",
          label: own(node),
          hint: "",
          checked: node.checked,
          disabled: off(node),
          toggle: node.getAttribute("role") === "switch",
        },
        node,
      );
    if (node instanceof HTMLSelectElement)
      return add(
        {
          kind: "select",
          label: own(node),
          value: node.value,
          options: [...node.options].map((o) => ({ value: o.value, label: o.text.trim() })),
          disabled: off(node),
        },
        node,
      );
    if (node.matches('button, [role="button"]'))
      return add(
        { kind: "button", label: lines(node).join(" ") || (node.getAttribute("aria-label") ?? "") },
        node,
      );
    if (node.matches('[role="slider"], [role="spinbutton"], [role="combobox"]'))
      return add({ kind: "other", label: own(node) }, node);
    for (const child of node.childNodes) visit(child);
  };
  for (const child of box.childNodes) visit(child);
  return read;
}

const decodeRead = Schema.decodeUnknownOption(
  Schema.Struct({ hash: Schema.String, read: XSettingsRead }),
);

/**
 * The next look at X's settings page that differs from the one hashed `last`: X's page answers
 * once its page changes, or after a while with what it has. Null when X's page could not answer
 * (none, or loading anew).
 */
const nextRead = async (last: string, token: number, signal: AbortSignal) => {
  const answer = await xRunHeld(
    `(async () => {
    const read = ${readXSettings.toString()};
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const look = () => { const read_ = read(document, location.pathname); return { hash: hash(JSON.stringify(read_)), read: read_ }; };
    // Just moved there: X's router has the path at once but draws its page a moment later.
    if (${JSON.stringify(last)} === "") await new Promise((r) => setTimeout(r, 250));
    const now = look();
    if (now.hash !== ${JSON.stringify(last)}) return now;
    return new Promise((done) => {
      let quiet;
      const end = () => {
        observer.disconnect(); clearTimeout(quiet); clearTimeout(cap);
        document.removeEventListener("change", settle, true);
        if (window.__xtendSettingsWatch?.token === ${token}) delete window.__xtendSettingsWatch;
      };
      const finish = () => { end(); done(look()); };
      // X draws a burst of changes at once: one look once it settles.
      const settle = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => { if (look().hash !== ${JSON.stringify(last)}) finish(); }, 120);
      };
      const observer = new MutationObserver(settle);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-checked", "disabled"] });
      // A checkbox's state is a property: X may redraw nothing for it.
      document.addEventListener("change", settle, true);
      const cap = setTimeout(finish, 20000);
      window.__xtendSettingsWatch = { token: ${token}, stop: () => { end(); done(null); } };
    });
  })()`,
    signal,
  );
  return Option.getOrNull(decodeRead(answer));
};

let watches = 0;

/**
 * Moves the engine to X's settings page `path` through X's router and reads X's page into `onRead`
 * each time X redraws it, until `signal` ends it. Only for the page the user has open; a read's
 * own `path` says where X is, which X may have changed (a page it sends elsewhere).
 */
export const watchXSettings = (
  path: string,
  signal: AbortSignal,
  onRead: (read: XSettingsRead) => void,
) => {
  const token = ++watches;
  signal.addEventListener(
    "abort",
    () =>
      void xRun(
        `window.__xtendSettingsWatch?.token === ${token} && window.__xtendSettingsWatch.stop(), true`,
      ),
    { once: true },
  );
  void (async () => {
    await xGo(`https://x.com${path}`);
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

/** Xtend's bar over X's own page on the main area: which page it is, and the way back. */
export const xPageBarAtom = Atom.make<{
  readonly title: string;
  readonly back: () => void;
} | null>(null);

/** Each settings page as X last drew it, by path; the account's own (a switch reloads the app). */
export const xSettingsAtom = Atom.make<ReadonlyMap<string, XSettingsRead>>(new Map()).pipe(
  Atom.keepAlive,
);

/** The item a press is for, as Xtend drew it: X's page must still draw the same there. */
const sameItem = (a: XSettingsItem, b: XSettingsItem) =>
  a.kind === b.kind &&
  ("label" in a ? a.label : a.text) === ("label" in b ? b.label : b.text) &&
  (a.kind !== "radio" || (b.kind === "radio" && a.group === b.group));

const decodeItem = Schema.decodeUnknownOption(XSettingsItem);

/**
 * Item `index` of X's page `path` once X draws it changed from `item`, or as it is after two
 * seconds: what an answer in X's own confirm left it at. Null when X draws another control there.
 */
export const xSettingsNow = async (path: string, index: number, item: XSettingsItem) =>
  Option.getOrNull(
    decodeItem(
      await xRun(`(async () => {
    const read = ${readXSettings.toString()};
    const same = ${sameItem.toString()};
    const was = ${JSON.stringify(item)};
    let now = null;
    for (let i = 0; i < 20; i++) {
      if (location.pathname !== ${JSON.stringify(path)}) return null;
      now = read(document, location.pathname).items[${index}] ?? null;
      if (!now || !same(now, was)) return null;
      if (JSON.stringify(now) !== JSON.stringify(was)) return now;
      await new Promise((r) => setTimeout(r, 100));
    }
    return now;
  })()`),
    ),
  );

// X's own confirm sheets (Protect your posts?) and dialogs a press opens.
const ASKS = `[role="alertdialog"], [data-testid="confirmationSheetDialog"], [data-testid="sheetDialog"]`;

/**
 * Presses item `index` of X's page `path` for the user's click, only while X draws `item` there:
 * a click, or `value` picked in a select. What X asks next shows over the main area until answered
 * there. "done", "over" once answered, "cancelled" when the user moved on; null when X's page drew
 * something else there and nothing was pressed.
 */
export const xSettingsPress = async (
  path: string,
  index: number,
  item: XSettingsItem,
  over: (shown: boolean) => void,
  value?: string,
) => {
  const answer = await xPressOver(
    (mine) => `(async () => {
    const read = ${readXSettings.toString()};
    const same = ${sameItem.toString()};
    if (location.pathname !== ${JSON.stringify(path)} || !${mine}) return null;
    const nodes = [];
    const now = read(document, location.pathname, nodes).items[${index}];
    const node = nodes[${index}];
    if (!now || !node || !same(now, ${JSON.stringify(item)})) return null;
    if (node instanceof HTMLSelectElement) {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(node, ${JSON.stringify(value ?? "")});
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else node.click();
    // X's confirm comes up a moment after the click, and a button may open X's own page.
    for (let i = 0; i < 10; i++) {
      if (!${mine}) return "cancelled";
      if (document.querySelector(${JSON.stringify(ASKS)}) || location.pathname !== ${JSON.stringify(path)}) return "over";
      await new Promise((r) => setTimeout(r, 100));
    }
    return "done";
  })()`,
    `!!document.querySelector(${JSON.stringify(ASKS)}) || location.pathname !== ${JSON.stringify(path)}`,
    over,
  );
  return answer === "done" || answer === "over" || answer === "cancelled" ? answer : null;
};
