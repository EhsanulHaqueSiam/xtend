import { expect, it, vi } from "vite-plus/test";

import { readGrok, xGrokHistory, xGrokHistoryPress, xGrokSend } from "./grok";
import { markXReady, registerXWebview, type XWebview } from "./x";

// X's Grok page (bundle.GrokXWeb) as it draws: X's header in its column, the transcript region
// with one turn per `data-turn-id`, X's answer under `data-quotable-message` with its markdown
// (Streamdown), sources pill and action row, then its composer fieldset.
const icon = (name: string) => `<svg data-icon="${name}"></svg>`;
const ANSWER = `<div class="group flex flex-col items-start gap-1" data-quotable-message="r1">
  <div class="flex w-full min-w-0 flex-col gap-3">
    <div class="flex flex-col gap-3"><button type="button" aria-expanded="false"><span>Thought for 14s</span><svg></svg></button></div>
    <div><div class="text-[15px] leading-relaxed"><h2 data-streamdown="heading-2">For two plans</h2>
      <ul data-streamdown="unordered-list"><li data-streamdown="list-item"><span data-streamdown="strong"><strong>Less to compare.</strong></span> <a data-streamdown="link" href="https://x.com/jonpark">@jonpark</a> posted a test.</li></ul>
      <p>Run <code data-streamdown="inline-code">two plans</code>, says @lenaw.</p>
      <div data-streamdown="table-wrapper"><table data-streamdown="table"><thead><tr><th>Plan</th><th>Signups</th></tr></thead><tbody><tr><td>Two</td><td>+18%</td></tr></tbody></table></div>
    </div></div>
    <button type="button" aria-expanded="false"><span aria-hidden="true"><span><img src="x.png"></span></span><span class="truncate">5 sources</span></button>
  </div>
  <div class="flex items-center"><div class="-ms-2 flex items-center">
    <button aria-label="Copy"><svg></svg></button>
    <button aria-label="Good response" aria-pressed="false">${icon("icon-thumbs-up")}</button>
    <button aria-label="Bad response" aria-pressed="true">${icon("icon-thumbs-down-fill")}</button>
    <button aria-label="Regenerate">${icon("icon-reload")}</button>
  </div></div>
</div>`;
const LIMIT = `<div class="group flex flex-col items-start gap-1" data-quotable-message="r2">
  <div class="flex w-full min-w-0 flex-col gap-3">
    <div class="flex flex-col items-start gap-2 rounded-2xl border px-4 py-3"><p>More Grok with SuperGrok</p><p role="status">You have reached your Grok usage limit. Upgrade for more access.</p><a href="https://x.com/i/premium_sign_up">Upgrade to SuperGrok</a></div>
  </div>
</div>`;
const turn = (id: string, question: string, answer: string) =>
  `<div data-turn-id="${id}" class="space-y-4"><div class="group/user flex flex-col items-end gap-2"><div class="relative flex max-w-[80%] flex-col items-end"><div class="text-primary rounded-chat bg-secondary px-4 py-2 whitespace-pre-wrap">${question}</div><div><button aria-label="Copy message"><svg></svg></button></div></div></div>${answer}</div>`;
const FOLLOW_UPS = `<div class="flex w-full flex-col gap-1 pt-1"><div><button><svg><path d="M15 10l5 5-5 5M4 4v7a4 4 0 0 0 4 4h12"></path></svg>Show Lena's numbers</button></div></div>`;
const composer = (busy = false) =>
  `<fieldset data-grok-composer=""><div class="relative"><div><div><textarea aria-label="Ask anything" placeholder="Ask anything"></textarea></div><div class="flex w-full items-center gap-1 p-3"><button aria-haspopup="menu" aria-expanded="false" aria-label="Attach">+</button><div class="ms-auto flex items-center gap-1"><button aria-haspopup="menu" aria-expanded="false" aria-label="Select a model Expert"><span><span>Expert</span></span></button>${busy ? `<button aria-label="Stop">${icon("icon-player-stop")}</button>` : `<button aria-label="Voice mode">${icon("icon-voice")}</button>`}</div></div></div></div></fieldset>`;
const page = (turns: string, header = '<a href="/i/grok">New chat</a>', busy = false) =>
  `<main><div data-testid="primaryColumn"><div><button aria-haspopup="dialog" aria-expanded="false">History</button>${header}</div><div role="region" aria-label="Conversation"><div class="space-y-4">${turns}</div></div><div>${composer(busy)}</div></div></main>`;

const historyRow = (id: string, title: string, age: string, pinned = false) =>
  `<li class="group overflow-hidden"><div class="relative flex h-12 items-center gap-2"><a href="/i/grok/c/${id}">${pinned ? icon("icon-pin-fill") : ""}<span class="text-primary min-w-0 truncate">${title}</span></a><div class="grid shrink-0 items-center justify-items-end"><span class="text-secondary col-start-1">${age}</span><div class="pointer-events-none flex items-center"><button aria-label="${pinned ? "Unpin" : "Pin"}">${icon(pinned ? "icon-pin-off" : "icon-pin")}</button><a aria-label="New tab" href="/i/grok/c/${id}" target="_blank">${icon("icon-arrow-up-right")}</a><button aria-label="Rename">${icon("icon-edit-line")}</button><button aria-label="Delete">${icon("icon-trashcan")}</button></div></div></div></li>`;
const HISTORY = `<div role="dialog" aria-label="History"><div><header><input type="search" aria-label="Search conversations" placeholder="Search…"></header><div class="scrollbar-thin-custom" aria-busy="false"><div class="w-full px-2 py-2"><ul class="flex flex-col">
  <li role="presentation"><h2>Pinned</h2></li>${historyRow("c1", "Weekly niche recap", "2 days ago", true)}
  <li role="presentation"><h2>Today</h2></li>${historyRow("c2", "Two-plan pricing", "3 hours ago")}${historyRow("c3", "Churn email", "5 hours ago")}
</ul><div class="h-px"></div></div></div></div></div>`;

/** X's page in this document for one test. */
const drawX = (markup: string) => {
  document.body.innerHTML = markup;
  return { [Symbol.dispose]: () => document.body.replaceChildren() };
};
/** The engine on X's page in this document, at `path`: its scripts run here, as in X's page. */
const engineAt = (path: string) => {
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${path}`,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(`return ${code.replaceAll("location.pathname", JSON.stringify(path))}`)(),
      ),
  } as unknown as XWebview);
  markXReady();
};

it("reads X's conversation by X's own markup: the question, X's thinking, markdown, sources, feedback and follow-ups", () => {
  using _x = drawX(page(turn("u1", "What are founders saying?", ANSWER) + FOLLOW_UPS));
  const read = readGrok(document, "/i/grok/c/c2");
  expect(read.page).toBe("xweb");
  const answer = read.turns?.[0]?.answer;
  expect([read.turns?.[0]?.user, answer?.trace, answer?.sources]).toEqual([
    "What are founders saying?",
    "Thought for 14s",
    "5 sources",
  ]);
  const plain = (b: NonNullable<typeof answer>["blocks"][number]) =>
    "runs" in b ? b.runs.map((r) => r.text).join("") : b.kind;
  expect(answer?.blocks.map(plain)).toEqual([
    "For two plans",
    "Less to compare. @jonpark posted a test.",
    "Run two plans, says @lenaw.",
    "table",
  ]);
  const [, item, para, table] = answer!.blocks;
  expect(item).toMatchObject({ kind: "li", ordered: false, depth: 0 });
  expect("runs" in item! && item.runs.slice(0, 3)).toEqual([
    { text: "Less to compare.", bold: true, italic: false, code: false, href: null },
    { text: " ", bold: false, italic: false, code: false, href: null },
    { text: "@jonpark", bold: false, italic: false, code: false, href: "https://x.com/jonpark" },
  ]);
  expect("runs" in para! && para.runs[1]).toMatchObject({ text: "two plans", code: true });
  expect(table).toMatchObject({ kind: "table", head: true });
  expect([answer?.done, answer?.feedback, answer?.regenerate]).toEqual([true, "down", true]);
  expect(read.followUps).toEqual(["Show Lena's numbers"]);
  expect([read.model, read.conversation, read.private]).toEqual(["Expert", true, null]);
  expect(read.composer).toEqual({
    placeholder: "Ask anything",
    text: "",
    disabled: false,
    busy: false,
    steer: null,
  });
});

it("reads X's usage limit as X's own note with its upgrade link, an answer still streaming as not done, and X's Private on a new chat", () => {
  using _x = drawX(
    page(turn("u2", "Again", LIMIT), '<button aria-pressed="true">Private</button>', true),
  );
  const read = readGrok(document, "/i/grok");
  expect(read.turns?.[0]?.answer?.blocks).toEqual([
    {
      kind: "note",
      text: "More Grok with SuperGrok\nYou have reached your Grok usage limit. Upgrade for more access.",
      link: { label: "Upgrade to SuperGrok", href: "https://x.com/i/premium_sign_up" },
    },
  ]);
  expect(read.turns?.[0]?.answer?.done).toBe(false);
  expect([read.private, read.conversation, read.composer?.busy]).toEqual([true, false, true]);
  // X's older Grok page draws no Grok composer of its own: Xtend leaves it to X.
  using _old = drawX(
    `<main><div data-testid="primaryColumn"><textarea placeholder="Ask anything"></textarea></div></main>`,
  );
  expect([readGrok(document, "/i/grok").page, readGrok(document, "/home").page]).toEqual([
    "other",
    null,
  ]);
});

it("reads X's history from X's own panel, opened and closed again, by group", async () => {
  using _x = drawX(page(""));
  engineAt("/i/grok");
  const button = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  // X's History button toggles its panel.
  button.addEventListener("click", () => {
    const open = document.querySelector('[role="dialog"]');
    if (open !== null) open.remove();
    else document.body.insertAdjacentHTML("beforeend", HISTORY);
    button.setAttribute("aria-expanded", String(open === null));
  });
  const history = await xGrokHistory();
  expect(history?.rows.map((r) => [r.id, r.title, r.group, r.age, r.pinned])).toEqual([
    ["c1", "Weekly niche recap", "Pinned", "2 days ago", true],
    ["c2", "Two-plan pricing", "Today", "3 hours ago", false],
    ["c3", "Churn email", "Today", "5 hours ago", false],
  ]);
  expect(history?.more).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("deletes a chat only through X's own Delete and X's confirm beside it, on the row asked for", async () => {
  using _x = drawX(page("") + HISTORY);
  engineAt("/i/grok");
  const row = (id: string) => document.querySelector(`a[href="/i/grok/c/${id}"]`)!.closest("li")!;
  const pressed: Array<string> = [];
  // X's Delete swaps the row's controls for its confirm: Cancel, then Delete, which removes it.
  row("c3")
    .querySelector('[aria-label="Delete"]')!
    .addEventListener("click", () => {
      pressed.push("delete");
      const grid = row("c3").querySelector(".grid")!;
      grid.outerHTML = `<div><button aria-label="Cancel"><svg></svg></button><button aria-label="Delete"><svg></svg></button></div>`;
      row("c3")
        .querySelectorAll("button")[1]!
        .addEventListener("click", () => (pressed.push("confirm"), row("c3").remove()));
    });
  expect(await xGrokHistoryPress("c3", "delete")).toBe("done");
  expect(pressed).toEqual(["delete", "confirm"]);
  expect(document.querySelectorAll('a[href^="/i/grok/c/"]:not([target])')).toHaveLength(2);
  // A row X does not draw gets no press at all.
  expect(await xGrokHistoryPress("c9", "delete")).toBeNull();
});

it("asks Grok through X's own composer and Send only on X's page it was asked on, and never over X's own draft", async () => {
  using _x = drawX(page(""));
  const field = document.querySelector("textarea")!;
  // X swaps its voice button for Send once the field holds text, and shows the question asked.
  field.addEventListener("input", () => {
    const voice = document.querySelector('fieldset [aria-label="Voice mode"]');
    if (field.value === "" || voice === null) return;
    voice.outerHTML = `<button aria-label="Send"><svg></svg></button>`;
    document.querySelector('[aria-label="Send"]')!.addEventListener("click", () => {
      document
        .querySelector('[role="region"] .space-y-4')!
        .insertAdjacentHTML("beforeend", turn("u9", field.value, ""));
      field.value = "";
    });
  });
  engineAt("/home");
  expect(await xGrokSend("/i/grok", "Hi")).toBeNull();
  expect(field.value).toBe("");
  engineAt("/i/grok");
  expect(await xGrokSend("/i/grok", "Who is quoting this?")).toEqual({ status: "sent" });
  expect(readGrok(document, "/i/grok").turns?.map((t) => t.user)).toEqual(["Who is quoting this?"]);
  field.value = "my own words";
  expect(await xGrokSend("/i/grok", "Hello")).toEqual({ status: "draft" });
  expect(field.value).toBe("my own words");
});

it("presses a row the user found by search under that same search in X's panel", async () => {
  // X's History lists the row only for its query: X's first page without it is older rows.
  using _x = drawX(page("") + HISTORY);
  engineAt("/i/grok");
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const list = document.querySelector('[role="dialog"] ul')!;
  const rows = {
    "": historyRow("c1", "Weekly niche recap", "2 days ago", true),
    churn: historyRow("c3", "Churn email", "5 hours ago"),
  };
  const show = () => (list.innerHTML = rows[search.value === "churn" ? "churn" : ""]);
  search.addEventListener("input", show);
  search.value = "churn";
  show();
  const pinned: Array<string> = [];
  document.addEventListener("click", (e) => {
    const button = (e.target as Element).closest('[aria-label="Pin"]');
    const id = button?.closest("li")?.querySelector("a")?.getAttribute("href");
    if (!button || id == null) return;
    pinned.push(id);
    button
      .closest("li")!
      .querySelector("a")!
      .insertAdjacentHTML("afterbegin", icon("icon-pin-fill"));
  });
  expect(await xGrokHistoryPress("c3", "pin", "", "churn")).toBe("done");
  expect([pinned, search.value]).toEqual([["/i/grok/c/c3"], "churn"]);
});

it("counts a send only on the conversation it was sent on, not another X moved to with the same question", async () => {
  using _x = drawX(page(turn("u1", "Again?", "")));
  const field = document.querySelector("textarea")!;
  // X takes the send, then shows conversation B, which asked the same question before.
  field.addEventListener("input", () => {
    const voice = document.querySelector('fieldset [aria-label="Voice mode"]');
    if (field.value === "" || voice === null) return;
    voice.outerHTML = `<button aria-label="Send"><svg></svg></button>`;
    document.querySelector('[aria-label="Send"]')!.addEventListener("click", () => {
      document.querySelector('[role="region"] .space-y-4')!.innerHTML =
        turn("b1", "Hello", "") + turn("b2", "Again?", "");
      field.value = "";
    });
  });
  engineAt("/i/grok");
  expect(await xGrokSend("/i/grok", "Again?")).toEqual({ status: "pending" });
});

it("takes a Rename done when the new title leaves the rail's search, as X then lists the row no more", async () => {
  using _x = drawX(page("") + HISTORY);
  engineAt("/i/grok");
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "churn";
  const list = document.querySelector('[role="dialog"] ul')!;
  list.innerHTML = historyRow("c3", "Churn email", "5 hours ago");
  // X's Rename: its own field and Save; the saved title no longer matches, so X drops the row.
  list.querySelector('[aria-label="Rename"]')!.addEventListener("click", () => {
    const li = list.querySelector("li")!;
    li.querySelector("a")!.outerHTML = `<input aria-label="Rename" value="Churn email">`;
    li.querySelector(".grid")!.outerHTML =
      `<div><button aria-label="Cancel"></button><button aria-label="Save"></button></div>`;
    li.querySelector('[aria-label="Save"]')!.addEventListener("click", () => li.remove());
  });
  expect(await xGrokHistoryPress("c3", "rename", "Retention notes", "churn")).toBe("done");
});

it("reads X's History as its own page in X's compact layout, and goes Back to the chat", async () => {
  using _x = drawX(page(""));
  // X's page moves: the engine's scripts read where X is now, and X's Back is X's own.
  const at = { path: "/i/grok/c/c2" };
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${at.path}`,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(
          "at",
          "back",
          `return ${code.replaceAll("location.pathname", "at.path").replaceAll("history.back()", "back()")}`,
        )(at, () => {
          at.path = "/i/grok/c/c2";
          document.querySelector("#history-page")?.remove();
        }),
      ),
  } as unknown as XWebview);
  markXReady();
  // In X's compact layout, History opens X's History page in its column, no panel.
  document.querySelector('[aria-haspopup="dialog"]')!.addEventListener("click", () => {
    at.path = "/i/grok/history";
    document
      .querySelector('[data-testid="primaryColumn"]')!
      .insertAdjacentHTML(
        "beforeend",
        `<div id="history-page">${HISTORY.replace('role="dialog"', "")}</div>`,
      );
  });
  const history = await xGrokHistory();
  expect(history?.rows.map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
  expect([at.path, document.querySelector("#history-page")]).toEqual(["/i/grok/c/c2", null]);
});

it("waits for X's Save on a Rename under the rail's search, and reports X keeping the old title", async () => {
  using _x = drawX(page("") + HISTORY);
  engineAt("/i/grok");
  const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "churn";
  const list = document.querySelector('[role="dialog"] ul')!;
  list.innerHTML = historyRow("c3", "Churn email", "5 hours ago");
  let saving = false;
  // X's Rename: its own field, then Save, which keeps the field while X saves.
  list.querySelector('[aria-label="Rename"]')!.addEventListener("click", () => {
    const li = list.querySelector("li")!;
    li.querySelector("a")!.outerHTML = `<input aria-label="Rename" value="Churn email">`;
    li.querySelector(".grid")!.outerHTML =
      `<div><button aria-label="Cancel"></button><button aria-label="Save"></button></div>`;
    li.querySelector('[aria-label="Save"]')!.addEventListener("click", () => (saving = true));
  });
  const renamed = xGrokHistoryPress("c3", "rename", "Retention notes", "churn");
  await vi.waitFor(() => expect(saving).toBe(true));
  // X's save failed: the row is back with its old title.
  list.innerHTML = historyRow("c3", "Churn email", "5 hours ago");
  expect(await renamed).toBeNull();
});

it("goes Back to the chat when X's compact History page opens without its search", async () => {
  using _x = drawX(page(""));
  const at = { path: "/i/grok/c/c2" };
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${at.path}`,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(
          "at",
          "back",
          `return ${code.replaceAll("location.pathname", "at.path").replaceAll("history.back()", "back()")}`,
        )(at, () => {
          at.path = "/i/grok/c/c2";
        }),
      ),
  } as unknown as XWebview);
  markXReady();
  // X opens its History page, which never draws its search field.
  document
    .querySelector('[aria-haspopup="dialog"]')!
    .addEventListener("click", () => (at.path = "/i/grok/history"));
  expect(await xGrokHistory()).toBeNull();
  expect(at.path).toBe("/i/grok/c/c2");
});
