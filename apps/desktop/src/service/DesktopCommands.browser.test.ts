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
  <button role="button" aria-label="Everyone can reply"><span>Everyone can reply</span></button>
  <div data-testid="toolBar">
    <input data-testid="fileInput" type="file" />
    <button data-testid="createPollButton" aria-label="Add poll">Poll</button>
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

/**
 * X's composer as the driver meets it. The reply button opens a HoverCard in #layers holding a
 * radiogroup of labels; a pick relabels the button and leaves the popover open until a press
 * outside it. `sticky` keeps it open anyway; `relabel` is a label X might change to.
 */
function fakeX(
  markup: string,
  log: Array<string>,
  { sticky = false, relabel }: { sticky?: boolean; relabel?: string } = {},
) {
  document.body.innerHTML = markup;
  const reply = document.querySelector<HTMLElement>('button[aria-label$="can reply"]');
  const layers = document.getElementById("layers");
  const pollBox = document.querySelector<HTMLElement>('[data-x="poll"]');
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
  document.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const popover = layers?.querySelector('[data-testid="HoverCard"]') ?? null;
    const row = target.closest<HTMLElement>('[role="radiogroup"] label');
    if (popover !== null && !popover.contains(target) && !sticky) popover.remove();
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
      const label = relabel ?? X_REPLY_LABELS[row.textContent?.trim() ?? ""] ?? "";
      reply.setAttribute("aria-label", label);
      reply.textContent = label;
    } else if (target.dataset.testid === "createPollButton" && pollBox !== null) {
      pollBox.innerHTML = `<div data-x="choices"></div><button data-testid="addPollChoice" aria-label="Add a choice">+</button>${select("selectPollDays", 7, 1)}${select("selectPollHours", 23, 0)}${select("selectPollMinutes", 59, 0)}<button data-testid="removePollButton">Remove poll</button>`;
      addChoice();
      addChoice();
    } else if (target.dataset.testid === "addPollChoice") addChoice();
    else if (target.dataset.testid === "tweetButton") {
      if (layers?.querySelector('[data-testid="HoverCard"]') !== null) log.push("popover open");
      log.push(`press Post, ${reply?.getAttribute("aria-label")}`);
    }
  });
}

/** Chromium's DevTools protocol over this page's DOM: the subset the driver sends. */
function domCdp(log: Array<string>) {
  const nodes: Array<Element> = [];
  const idOf = (el: Element) => (nodes.includes(el) ? nodes.indexOf(el) : nodes.push(el) - 1);
  const at = (params: Record<string, unknown>) => nodes[Number(params.nodeId ?? params.objectId)]!;
  return async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    switch (method) {
      case "DOM.getDocument":
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
      case "DOM.resolveNode":
        return { object: { objectId: String(params.nodeId) } };
      case "Runtime.callFunctionOn": {
        // oxlint-disable-next-line no-eval -- runs the declaration the driver sends, as Chromium would.
        const fn = (0, eval)(`(${String(params.functionDeclaration)})`) as (
          ...values: Array<unknown>
        ) => unknown;
        const args = params.arguments as Array<{ value: unknown }>;
        return {
          result: {
            value: fn.apply(
              at(params),
              args.map((a) => a.value),
            ),
          },
        };
      }
      case "Input.dispatchMouseEvent": {
        if (params.type !== "mouseReleased") return {};
        const el = document.elementFromPoint(Number(params.x), Number(params.y)) as HTMLElement;
        el.focus();
        el.click();
        return {};
      }
      case "Input.insertText": {
        const el = document.activeElement as HTMLElement;
        if (el instanceof HTMLInputElement) el.value += String(params.text);
        else el.textContent += String(params.text);
        log.push(`type ${String(params.text)}`);
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
  options?: Parameters<typeof fakeX>[2],
) => {
  using _timers = fakeTimers({ now: T0 });
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
  return { log, result: await posting };
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

it("refuses the post before Post when a control is missing, X names another setting, or its popover stays open", async () => {
  const noPoll = await run(
    COMPOSER.replace(/<button data-testid="createPollButton"[^]*?<\/button>/, ""),
    post({ poll: { options: ["a", "b"], durationMinutes: 60 } }),
  );
  expect(noPoll.result).toMatchObject({
    message: "x.com's composer has no Add poll; nothing was posted",
    notAttempted: true,
  });
  expect(noPoll.log).toEqual([]);

  const noReply = await run(
    COMPOSER.replace(/<button role="button" aria-label="Everyone can reply">[^]*?<\/button>/, ""),
    post({ replySettings: "verified" }),
  );
  expect(noReply.result).toMatchObject({ notAttempted: true });
  expect(noReply.log).toEqual([]);

  const renamed = await run(COMPOSER, post({ replySettings: "mentionedUsers" }), {
    relabel: "Mentioned accounts can reply",
  });
  expect(renamed.result).toMatchObject({
    message: 'x.com\'s composer has no "Only accounts you mention can reply"; nothing was posted',
    notAttempted: true,
  });
  expect(renamed.log).toEqual([]);

  const stuck = await run(COMPOSER, post({ replySettings: "following" }), { sticky: true });
  expect(stuck.result).toMatchObject({
    message: "x.com's reply settings stayed open; nothing was posted",
    notAttempted: true,
  });
  expect(stuck.log.some((l) => l.startsWith("press Post"))).toBe(false);
});
