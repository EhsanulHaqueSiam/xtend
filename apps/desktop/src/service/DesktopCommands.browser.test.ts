import type { DesktopCommand } from "@xtend/contracts";
import { expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../testing/fakeTimers.ts";
import { postThroughComposer } from "./DesktopCommands.ts";

// Deadlines count from this fixed instant on the faked clock.
const T0 = Date.parse("2026-11-02T12:00:00.000Z");

// x.com/compose/post's modal, trimmed to the controls the driver presses. The text box, the
// reply button's label and createPollButton were read live; the reply menu and the poll editor
// follow X_COMPOSER's unconfirmed selectors.
const COMPOSER = `
<div data-testid="tweetTextarea_0" contenteditable="true" style="width:200px;height:24px"></div>
<div data-x="poll"></div>
<button aria-label="Everyone can reply">Everyone can reply</button>
<div data-testid="toolBar">
  <input data-testid="fileInput" type="file" />
  <button data-testid="createPollButton" aria-label="Add poll">Poll</button>
  <button data-testid="tweetButton">Post</button>
</div>`;

const select = (testid: string, max: number, selected: number) =>
  `<select data-testid="${testid}">${Array.from({ length: max + 1 }, (_, n) => `<option value="${n}"${n === selected ? " selected" : ""}>${n}</option>`).join("")}</select>`;

/** X's composer as the driver meets it: presses open the menu, take a row, add the poll and its choices. */
function fakeX(markup: string, log: Array<string>) {
  document.body.innerHTML = markup;
  const reply = document.querySelector<HTMLElement>('[aria-label$="can reply"]');
  const pollBox = document.querySelector<HTMLElement>('[data-x="poll"]');
  let choices = 0;
  const addChoice = () => {
    choices++;
    pollBox
      ?.querySelector("[data-x=choices]")
      ?.insertAdjacentHTML("beforeend", `<input name="Choice${choices}" />`);
  };
  document.body.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest('[role="menuitem"]');
    if (target === reply && reply.getAttribute("aria-label") === "Everyone can reply")
      reply.insertAdjacentHTML(
        "afterend",
        `<div role="menu">${["Everyone", "Accounts you follow", "Verified accounts", "Only accounts you mention"].map((r) => `<div role="menuitem"><span>${r}</span></div>`).join("")}</div>`,
      );
    else if (row !== null && reply !== null) {
      reply.setAttribute("aria-label", `${row.textContent} can reply`);
      row.parentElement?.remove();
    } else if (target.dataset.testid === "createPollButton" && pollBox !== null) {
      pollBox.innerHTML = `<div data-x="choices"></div><button aria-label="Add a choice">+</button>${select("selectPollDays", 7, 1)}${select("selectPollHours", 23, 0)}${select("selectPollMinutes", 59, 0)}`;
      addChoice();
      addChoice();
    } else if (target.getAttribute("aria-label") === "Add a choice") addChoice();
    else if (target.dataset.testid === "tweetButton") log.push("press Post");
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

const run = async (markup: string, command: Extract<DesktopCommand, { type: "sessionPost" }>) => {
  using _timers = fakeTimers({ now: T0 });
  const log: Array<string> = [];
  fakeX(markup, log);
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
  expect(log).toEqual(["type tea", "type coffee", "type both", "type which?", "press Post"]);
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
  expect(document.querySelector('[aria-label="Accounts you follow can reply"]')).not.toBeNull();
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

  const noReply = await run(
    COMPOSER.replace(/<button aria-label="Everyone can reply">[^]*?<\/button>/, ""),
    post({ replySettings: "verified" }),
  );
  expect(noReply.result).toMatchObject({ notAttempted: true });
  expect(noReply.log).toEqual([]);
});
