import type { DesktopCommand } from "@xtend/contracts";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../testing/fakeTimers.ts";
import { postThroughComposer } from "./DesktopCommands.ts";

// Deadlines count from this fixed instant on the faked clock.
const T0 = Date.parse("2026-11-02T12:00:00.000Z");

// x.com/compose/post as read live on 2026-11-02, trimmed to the controls the driver presses:
// the modal in the react root, X's popovers in #layers after it.
const COMPOSER = `
<div id="react-root">
  <div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" style="width:200px;height:24px"></div>
  <div data-x="poll"></div>
  <div data-x="media"></div>
  <button role="button" aria-label="Everyone can reply"><span>Everyone can reply</span></button>
  <div data-testid="toolBar">
    <input data-testid="fileInput" type="file" />
    <button data-testid="createPollButton" aria-label="Add poll">Poll</button>
    <button data-testid="gifSearchButton" aria-label="Add a GIF">GIF</button>
    <button data-testid="tweetButton">Post</button>
  </div>
</div>
<div id="layers"></div>`;

/** X's reply rows in its order, and the label its button takes once each is picked. */
const X_REPLY_LABELS: Record<string, string> = {
  Everyone: "Everyone can reply",
  "Accounts you follow": "Accounts you follow can reply",
  "Accounts you follow and who they follow": "Accounts you follow and who they follow can reply",
  "Only accounts you mention": "Only accounts you mention can reply",
  "Verified accounts": "Only Verified accounts can reply",
};

const select = (testid: string, max: number, selected: number) =>
  `<select data-testid="${testid}">${Array.from({ length: max + 1 }, (_, n) => `<option value="${n}"${n === selected ? " selected" : ""}>${n}</option>`).join("")}</select>`;

interface FakeOptions {
  /** The reply popover ignores presses outside it. */
  readonly sticky?: boolean;
  /** A label X might change to, for every row but Everyone. */
  readonly relabel?: string;
  /** The poll editor X draws: no + for a third choice, or no Remove poll. */
  readonly noAddChoice?: boolean;
  readonly noRemovePoll?: boolean;
  /** Post stays disabled, as while an upload never finishes. */
  readonly postDisabled?: boolean;
  /** X's compact layout (the engine's width): the GIF search is a page with the only Back. */
  readonly compact?: boolean;
  /** How long X takes to take a Back in its GIF search, and to remove the search after leaving. */
  readonly backMs?: number;
  readonly lingerMs?: number;
  /** History entries X pushes for each query searched (X's own count is one), the rest by URL. */
  readonly entriesPerQuery?: number;
  /** X lets the account format (its claim for Premium): X's ⌘B and ⌘I style what is typed next. */
  readonly formatting?: boolean;
}

/** X's composer page and its GIF search route, on this document's URL. */
const COMPOSE_PATH = "/compose/post";
const GIF_PATH = "/i/foundmedia/search";

/** X's GIF search for "cat", page by page: X adds the next as its list scrolls to the end. */
const CAT_PAGES = [["g1", "g2"], ["g3"]];
const tile = (id: string) =>
  `<button><div data-testid="gifSearchGifImage" aria-label="Cat GIF" style="display:block;width:80px;height:40px;background-image:url(/media/${id}/200_d.gif)"></div></button>`;

/**
 * X's composer as the driver meets it. The reply button opens a HoverCard in #layers holding a
 * radiogroup of labels; a pick relabels the button and leaves the popover open until a press
 * outside it. Attachments carry X's remove button.
 */
function fakeX(markup: string, log: Array<string>, options: FakeOptions = {}) {
  document.body.innerHTML = markup;
  const reply = document.querySelector<HTMLElement>('button[aria-label$="can reply"]');
  const layers = document.getElementById("layers");
  // Body outlives a test with its listeners, so what one draws goes in this markup's own nodes.
  const root = document.getElementById("react-root");
  const pollBox = document.querySelector<HTMLElement>('[data-x="poll"]');
  const mediaBox = document.querySelector<HTMLElement>('[data-x="media"]');
  if (options.postDisabled === true)
    document.querySelector('[data-testid="tweetButton"]')?.setAttribute("aria-disabled", "true");
  let choices = 0;
  const addChoice = () => {
    choices++;
    pollBox
      ?.querySelector("[data-x=choices]")
      ?.insertAdjacentHTML(
        "beforeend",
        `<label><span>Choice ${choices}</span><input name="Choice${choices}" /></label>`,
      );
  };
  history.replaceState(null, "", COMPOSE_PATH);
  // X's editor (Draft.js): its command key per its user agent toggles the style of what is typed
  // next, drawn as a styled leaf; for an account X does not let format, the keys do nothing.
  const box = document.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"]');
  const typing = { Bold: false, Italic: false };
  box?.addEventListener("keydown", (event) => {
    const command = /Mac OS X/.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
    const style = command ? ({ b: "Bold", i: "Italic" } as const)[event.key] : undefined;
    if (style === undefined || options.formatting !== true) return;
    event.preventDefault();
    typing[style] = !typing[style];
    log.push(`${style} ${typing[style] ? "on" : "off"}`);
  });
  box?.addEventListener("beforeinput", (event) => {
    if (!typing.Bold && !typing.Italic) return;
    event.preventDefault();
    const leaf = document.createElement("span");
    leaf.dataset.offsetKey = "leaf";
    leaf.style.fontWeight = typing.Bold ? "700" : "400";
    leaf.style.fontStyle = typing.Italic ? "italic" : "normal";
    leaf.textContent = event.data;
    box.append(leaf);
  });
  document.body.addEventListener("click", (event) => {
    // An earlier test's X, still listening on body, is gone.
    if (root?.isConnected !== true) return;
    const target = event.target as HTMLElement;
    const popover = layers?.querySelector('[data-testid="HoverCard"]') ?? null;
    const row = target.closest<HTMLElement>('[role="radiogroup"] label');
    if (popover !== null && !popover.contains(target) && options.sticky !== true) popover.remove();
    if (target.closest("button") === reply && reply !== null && popover === null) {
      const current = reply.getAttribute("aria-label");
      layers?.insertAdjacentHTML(
        "beforeend",
        `<div data-testid="HoverCard"><div role="radiogroup">${Object.entries(X_REPLY_LABELS)
          .map(
            ([text, label]) =>
              `<label style="display:block"><input type="radio"${label === current ? " checked" : ""} /><span>${text}</span></label>`,
          )
          .join("")}</div></div>`,
      );
    } else if (row !== null && reply !== null) {
      const text = row.textContent?.trim() ?? "";
      const label = text === "Everyone" ? undefined : options.relabel;
      reply.setAttribute("aria-label", label ?? X_REPLY_LABELS[text] ?? "");
      reply.textContent = label ?? X_REPLY_LABELS[text] ?? "";
    } else if (target.dataset.testid === "createPollButton" && pollBox !== null) {
      pollBox.innerHTML = `<div data-x="choices"></div>${options.noAddChoice === true ? "" : '<button data-testid="addPollChoice" aria-label="Add a choice">+</button>'}${select("selectPollDays", 7, 1)}${select("selectPollHours", 23, 0)}${select("selectPollMinutes", 59, 0)}${options.noRemovePoll === true ? "" : '<button data-testid="removePollButton">Remove poll</button>'}`;
      addChoice();
      addChoice();
    } else if (target.dataset.testid === "addPollChoice") addChoice();
    else if (target.dataset.testid === "removePollButton" && pollBox !== null) {
      pollBox.innerHTML = "";
      choices = 0;
    } else if (target.closest('[aria-label="Remove media"]') !== null)
      target.closest("[data-x=attachment]")?.remove();
    else if (target.closest('[data-testid="gifSearchButton"]') !== null) {
      // X's GIF search on its own route over the composer: the tiles for what is typed, the next
      // page on scroll, and a history entry for each query searched, which one Back steps out of.
      history.replaceState(null, "", GIF_PATH);
      const search = `<div class="bar"><button data-testid="app-bar-back">Back</button></div><div><input placeholder="Search for GIFs" /></div><div data-x="tiles"></div>`;
      const page = document.createElement(options.compact === true ? "main" : "div");
      page.dataset.x = "gif-search";
      if (options.compact !== true) page.setAttribute("role", "dialog");
      page.innerHTML = search;
      (options.compact === true ? root : layers)?.append(page);
      const field = page.querySelector("input")!;
      const tiles = page.querySelector<HTMLElement>("[data-x=tiles]")!;
      let pages = 0;
      // The entries after the one the search opened on, each with the query it shows.
      const entries: Array<{ readonly url: string; readonly value: string }> = [];
      field.addEventListener("input", () => {
        log.push(`search ${field.value}`);
        for (let i = 0; i < (options.entriesPerQuery ?? 1); i++)
          entries.push({ url: i === 0 ? GIF_PATH : `${GIF_PATH}?n=${i}`, value: field.value });
        pages = field.value === "cat" ? 1 : 0;
        tiles.innerHTML = pages === 0 ? "" : CAT_PAGES[0]!.map(tile).join("");
      });
      tiles.addEventListener("scroll", () => {
        if (pages === 0 || pages >= CAT_PAGES.length) return;
        tiles.insertAdjacentHTML("beforeend", CAT_PAGES[pages++]!.map(tile).join(""));
      });
      page.querySelector("button")!.addEventListener("click", () => {
        log.push("gif search back");
        setTimeout(() => {
          if (entries.pop() !== undefined) {
            const now = entries.at(-1) ?? { url: GIF_PATH, value: "" };
            history.replaceState(null, "", now.url);
            field.value = now.value;
          } else {
            history.replaceState(null, "", COMPOSE_PATH);
            setTimeout(() => page.remove(), options.lingerMs ?? 0);
          }
        }, options.backMs ?? 100);
      });
    } else if (target.dataset.testid === "gifSearchGifImage") {
      log.push(`gif ${/\/media\/(\w+)\//.exec(target.getAttribute("style") ?? "")?.[1]}`);
      history.replaceState(null, "", COMPOSE_PATH);
      target.closest("[data-x=gif-search]")?.remove();
      mediaBox?.insertAdjacentHTML(
        "beforeend",
        '<div data-x="attachment"><button aria-label="Remove media">x</button></div>',
      );
    } else if (target.dataset.testid === "tweetButton") {
      if (layers?.querySelector('[data-testid="HoverCard"]') !== null) log.push("popover open");
      log.push(`press Post, ${reply?.getAttribute("aria-label")}`);
    }
  });
}

/** What X's composer holds now: what a refusal must have taken back out. */
const composer = () => ({
  text: document.querySelector('[data-testid="tweetTextarea_0"]')?.textContent,
  reply: document.querySelector('button[aria-label$="can reply"]')?.getAttribute("aria-label"),
  popover: document.querySelector('[data-testid="HoverCard"]') !== null,
  poll: document.querySelector("input[name^=Choice]") !== null,
  media: document.querySelectorAll("[data-x=attachment]").length,
  gifSearch: document.querySelector('input[placeholder="Search for GIFs"]') !== null,
});

const EMPTY = {
  text: "",
  reply: "Everyone can reply",
  popover: false,
  poll: false,
  media: 0,
  gifSearch: false,
};

/** Chromium's DevTools protocol over this page's DOM: the subset the driver sends. */
function domCdp(log: Array<string>) {
  // Chromium's node ids: new ones only, and DOM.getDocument drops every one handed out before.
  let ids = new Map<Element, number>();
  let last = 0;
  // What a select-all command selected, for the Backspace after it.
  let selected: Element | null = null;
  const idOf = (el: Element) => ids.get(el) ?? (ids.set(el, ++last), last);
  const at = (params: Record<string, unknown>) => {
    const id = Number(params.nodeId ?? params.objectId);
    for (const [el, known] of ids) if (known === id) return el;
    throw new Error("Could not find node with given id");
  };
  return async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    switch (method) {
      case "DOM.getDocument":
        ids = new Map();
        return { root: { nodeId: idOf(document.documentElement) } };
      case "DOM.querySelectorAll":
        return {
          nodeIds: Array.from(at(params).querySelectorAll(String(params.selector)), idOf),
        };
      case "DOM.getAttributes":
        return {
          attributes: at(params)
            .getAttributeNames()
            .flatMap((n) => [n, at(params).getAttribute(n)]),
        };
      case "DOM.getOuterHTML":
        return { outerHTML: at(params).outerHTML };
      case "DOM.getBoxModel": {
        const r = at(params).getBoundingClientRect();
        return {
          model: { content: [r.left, r.top, r.right, r.top, r.right, r.bottom, r.left, r.bottom] },
        };
      }
      case "DOM.scrollIntoViewIfNeeded":
        at(params).scrollIntoView();
        // The scroll X's list sees.
        at(params).closest("[data-x=tiles]")?.dispatchEvent(new Event("scroll"));
        return {};
      case "DOM.resolveNode":
        return { object: { objectId: String(params.nodeId) } };
      case "Runtime.callFunctionOn": {
        // oxlint-disable-next-line no-eval -- runs the declaration the driver sends, as Chromium would.
        const fn = (0, eval)(`(${String(params.functionDeclaration)})`) as (
          ...values: Array<unknown>
        ) => unknown;
        const args = (params.arguments as Array<{ value: unknown }> | undefined) ?? [];
        const value = fn.apply(
          at(params),
          args.map((a) => a.value),
        );
        // A node handed back by reference, as Chromium answers without returnByValue.
        return params.returnByValue === false
          ? { result: value instanceof Element ? { objectId: String(idOf(value)) } : {} }
          : { result: { value } };
      }
      case "Runtime.evaluate":
        // oxlint-disable-next-line no-eval -- runs the expression the driver sends, as Chromium would.
        return { result: { value: (0, eval)(String(params.expression)) as unknown } };
      case "DOM.requestNode":
        return { nodeId: Number(params.objectId) };
      case "Input.dispatchMouseEvent": {
        if (params.type !== "mouseReleased") return {};
        const el = document.elementFromPoint(Number(params.x), Number(params.y)) as HTMLElement;
        el.focus();
        el.click();
        return {};
      }
      case "DOM.setFileInputFiles":
        for (const _ of params.files as Array<string>)
          document
            .querySelector("[data-x=media]")
            ?.insertAdjacentHTML(
              "beforeend",
              '<div data-x="attachment"><button aria-label="Remove media">x</button></div>',
            );
        return {};
      case "Input.dispatchKeyEvent": {
        const el = document.activeElement as HTMLElement;
        const modifiers = Number(params.modifiers ?? 0);
        if (params.type === "rawKeyDown" && modifiers > 0)
          el.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: String(params.key),
              code: String(params.code),
              metaKey: (modifiers & 4) !== 0,
              ctrlKey: (modifiers & 2) !== 0,
              bubbles: true,
              cancelable: true,
            }),
          );
        if ((params.commands as Array<string> | undefined)?.includes("selectAll")) selected = el;
        if (params.type === "rawKeyDown" && params.key === "Backspace" && selected === el) {
          if (el instanceof HTMLInputElement) el.value = "";
          else el.textContent = "";
        }
        return {};
      }
      case "Input.insertText": {
        const el = document.activeElement as HTMLElement;
        log.push(`type ${String(params.text)}`);
        // The page may type it itself, as X's editor does.
        const typed = new InputEvent("beforeinput", {
          data: String(params.text),
          inputType: "insertText",
          bubbles: true,
          cancelable: true,
        });
        if (!el.dispatchEvent(typed)) return {};
        if (el instanceof HTMLInputElement) el.value += String(params.text);
        else el.append(String(params.text));
        return {};
      }
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
}

const post = (extra: Partial<Extract<DesktopCommand, { type: "sessionPost" }>>) =>
  ({ type: "sessionPost", text: "which?", mediaPaths: [], ...extra }) as const;

const run = async (
  markup: string,
  command: Extract<DesktopCommand, { type: "sessionPost" }>,
  options?: FakeOptions,
) => {
  using _timers = fakeTimers({ now: T0 });
  const start = location.href;
  const log: Array<string> = [];
  fakeX(markup, log, options);
  const posting = postThroughComposer(
    { loadURL: async () => {} },
    domCdp(log),
    command,
    async () => "777",
    T0 + 60_000,
  ).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  const path = location.pathname;
  history.replaceState(null, "", start);
  return { log, result: await posting, path };
};

it("fills X's poll and picks who can reply in X's own composer before typing and pressing Post", async () => {
  const { log, result } = await run(
    COMPOSER,
    post({
      replySettings: "following",
      poll: { options: ["tea", "coffee", "both"], durationMinutes: 4380 },
    }),
  );
  expect(result).toBe("777");
  // The row is "Accounts you follow" itself, not the longer one that starts with it, and the
  // popover is closed by the press into the text before Post.
  expect(log).toEqual([
    "type tea",
    "type coffee",
    "type both",
    "type which?",
    "press Post, Accounts you follow can reply",
  ]);
  const value = (selector: string) => document.querySelector<HTMLSelectElement>(selector)?.value;
  // 3 days, 1 hour and 0 minutes.
  expect(
    ["Days", "Hours", "Minutes"].map((u) => value(`select[data-testid="selectPoll${u}"]`)),
  ).toEqual(["3", "1", "0"]);
  expect(
    Array.from(
      document.querySelectorAll("input[name^=Choice]"),
      (i) => (i as HTMLInputElement).value,
    ),
  ).toEqual(["tea", "coffee", "both"]);
});

it('waits for X\'s odd one out, "Only Verified accounts can reply", before Post', async () => {
  const { log, result } = await run(COMPOSER, post({ replySettings: "verified" }));
  expect(result).toBe("777");
  expect(log).toEqual(["type which?", "press Post, Only Verified accounts can reply"]);
});

it("refuses the post untouched when X draws no poll or reply control, and never presses Post", async () => {
  const noPoll = await run(
    COMPOSER.replace(/<button data-testid="createPollButton"[^]*?<\/button>/, ""),
    post({ poll: { options: ["a", "b"], durationMinutes: 60 } }),
  );
  expect(noPoll.result).toMatchObject({
    message: "x.com's composer has no Add poll; nothing was posted",
    notAttempted: true,
  });
  expect(noPoll.log).toEqual([]);

  // Who can reply is set first, so a missing reply control fails before the poll is filled.
  const noReply = await run(
    COMPOSER.replace(/<button role="button" aria-label="Everyone can reply">[^]*?<\/button>/, ""),
    post({ replySettings: "verified", poll: { options: ["a", "b"], durationMinutes: 60 } }),
  );
  expect(noReply.result).toMatchObject({ notAttempted: true });
  expect(noReply.log).toEqual([]);
  expect(composer().poll).toBe(false);
});

it("takes back the reply setting and the poll it filled when a later poll control is missing", async () => {
  const { log, result } = await run(
    COMPOSER,
    post({
      replySettings: "mentionedUsers",
      poll: { options: ["a", "b", "c"], durationMinutes: 60 },
    }),
    { noAddChoice: true },
  );
  expect(result).toMatchObject({
    message: "x.com's composer has no Add a choice; nothing was posted",
    notAttempted: true,
  });
  expect(log).toEqual(["type a", "type b"]);
  expect(composer()).toEqual({ ...EMPTY, text: "" });
});

it("takes back the text, media and reply setting when Post never enables", async () => {
  const { log, result } = await run(
    COMPOSER,
    post({ replySettings: "following", mediaPaths: ["/tmp/a.png", "/tmp/b.png"] }),
    { postDisabled: true },
  );
  // Post was never pressed, so the service may say so instead of "may already be on X".
  expect(result).toMatchObject({
    message: 'composer element not ready: button[data-testid="tweetButton"]; nothing was posted',
    notAttempted: true,
  });
  expect(log.some((l) => l.startsWith("press Post"))).toBe(false);
  expect(composer()).toEqual(EMPTY);
});

it("refuses before Post when X names another setting or its popover stays open, and says what it could not take back", async () => {
  const renamed = await run(COMPOSER, post({ replySettings: "mentionedUsers" }), {
    relabel: "Mentioned accounts can reply",
  });
  expect(renamed.result).toMatchObject({
    message: 'x.com\'s composer has no "Only accounts you mention can reply"; nothing was posted',
    notAttempted: true,
  });
  expect(renamed.log).toEqual([]);
  expect(composer()).toEqual(EMPTY);

  const stuck = await run(COMPOSER, post({ replySettings: "following" }), { sticky: true });
  expect(stuck.result).toMatchObject({
    message:
      "x.com's reply settings stayed open; nothing was posted; X's composer may still hold an open reply popover, the reply setting",
    notAttempted: true,
  });
  expect(stuck.log.some((l) => l.startsWith("press Post"))).toBe(false);

  const keeps = await run(
    COMPOSER,
    post({ poll: { options: ["a", "b", "c"], durationMinutes: 60 } }),
    { noAddChoice: true, noRemovePoll: true },
  );
  expect(keeps.result).toMatchObject({
    message:
      "x.com's composer has no Add a choice; nothing was posted; X's composer may still hold the poll",
  });
});

it("picks the GIF in X's own search, paging X's list to reach it, before typing and pressing Post", async () => {
  const { log, result } = await run(
    COMPOSER,
    post({ text: "meow", gif: { query: "cat", id: "giphy_g3" } }),
  );
  expect(result).toBe("777");
  expect(log).toEqual(["search cat", "gif g3", "type meow", "press Post, Everyone can reply"]);
  expect(composer()).toEqual({ ...EMPTY, text: "meow", media: 1 });
});

it("leaves X's GIF search a query at a time, only while X is on it, and refuses before Post when the picked GIF is not in it", async () => {
  // As at the engine's width, where X's GIF search is a page: X takes a while to take each Back,
  // and draws its search a while longer once it has left it.
  const { log, result, path } = await run(
    COMPOSER,
    post({ replySettings: "following", gif: { query: "cat", id: "giphy_g9" } }),
    { compact: true, backMs: 400, lingerMs: 2_000 },
  );
  expect(result).toMatchObject({
    message: 'x.com\'s composer has no GIF "giphy_g9" in its search for "cat"; nothing was posted',
    notAttempted: true,
  });
  // "cat", then the search X opened on: never a Back once X is back in its composer.
  expect([log, path]).toEqual([["search cat", "gif search back", "gif search back"], COMPOSE_PATH]);
  expect(composer()).toEqual(EMPTY);
});

it("takes as many Backs as X's search holds entries, up to the last one it may press", async () => {
  // X kept 19 entries for the query: 20 Backs in all, the most the driver presses.
  const { log, result, path } = await run(
    COMPOSER,
    post({ gif: { query: "cat", id: "giphy_g9" } }),
    { compact: true, entriesPerQuery: 19 },
  );
  expect(result).toMatchObject({
    message: 'x.com\'s composer has no GIF "giphy_g9" in its search for "cat"; nothing was posted',
  });
  expect([log.filter((l) => l === "gif search back").length, path]).toEqual([20, COMPOSE_PATH]);
});

it("types bold and italic with X's own command keys where each run starts and ends, then presses Post", async () => {
  const { log, result } = await run(
    COMPOSER,
    post({
      text: "go big now",
      styles: [
        { start: 3, end: 6, style: "Bold" },
        { start: 7, end: 10, style: "Italic" },
      ],
    }),
    { formatting: true },
  );
  expect(result).toBe("777");
  expect(log).toEqual([
    "type go ",
    "Bold on",
    "type big",
    "Bold off",
    "type  ",
    "Italic on",
    "type now",
    "press Post, Everyone can reply",
  ]);
});

it("refuses before Post, and takes the text back, when X does not apply the formatting", async () => {
  // An account X does not let format: X's keys do nothing, and Post would send the text plain.
  const { log, result } = await run(
    COMPOSER,
    post({ text: "go big", styles: [{ start: 3, end: 6, style: "Bold" }] }),
  );
  expect(result).toMatchObject({
    message: "x.com's composer has no bold text; nothing was posted",
    notAttempted: true,
  });
  expect(log.some((l) => l.startsWith("press Post"))).toBe(false);
  expect(composer()).toEqual(EMPTY);
});
