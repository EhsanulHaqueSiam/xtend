import "../../index.css";
import { useLocation } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";

// The screen reads the bridge at module load (env.ts), so it is imported after the bridge exists.
installFakeBridge();
const { Route } = await import("../../routes/grok");
const { markXReady, registerXWebview } = await import("../../state/x");

// X's Grok page (bundle.GrokXWeb) as the engine page holds it: header, transcript, composer.
const icon = (name: string) => `<svg data-icon="${name}"></svg>`;
const answer = (id: string, words: string) =>
  `<div class="group flex flex-col items-start gap-1" data-quotable-message="${id}"><div class="flex w-full min-w-0 flex-col gap-3"><div><div><p>${words}</p></div></div></div><div class="flex items-center"><div><button aria-label="Copy"><svg></svg></button><button aria-label="Good response" aria-pressed="false">${icon("icon-thumbs-up")}</button><button aria-label="Bad response" aria-pressed="false">${icon("icon-thumbs-down")}</button><button aria-label="Regenerate">${icon("icon-reload")}</button></div></div></div>`;
const turn = (id: string, question: string, words: string) =>
  `<div data-turn-id="${id}"><div class="group/user"><div><div class="whitespace-pre-wrap">${question}</div></div></div>${answer(`r${id}`, words)}</div>`;
const PAGE = `<main><div data-testid="primaryColumn"><div><button aria-haspopup="dialog" aria-expanded="false">History</button><a href="/i/grok">New chat</a></div>
  <div role="region" aria-label="Conversation"><div class="space-y-4">${turn("u1", "Who is behind two-plan pricing?", 'Mostly <a href="https://x.com/jonpark">@jonpark</a>.')}</div></div>
  <fieldset data-grok-composer=""><textarea placeholder="Ask anything"></textarea><div><button aria-haspopup="menu" aria-expanded="false">+</button><div><button aria-haspopup="menu" aria-expanded="false"><span>Auto</span></button><button aria-label="Voice mode">${icon("icon-voice")}</button></div></div></fieldset>
</div></main>`;
const row = (id: string, title: string) =>
  `<li><div><a href="/i/grok/c/${id}"><span>${title}</span></a><div class="grid"><span>1 hour ago</span><div><button aria-label="Pin">${icon("icon-pin")}</button><button aria-label="Rename">${icon("icon-edit-line")}</button><button aria-label="Delete">${icon("icon-trashcan")}</button></div></div></div></li>`;
const HISTORY = `<div role="dialog"><input type="search"><div aria-busy="false"><div><ul><li role="presentation"><h2>Today</h2></li>${row("c1", "Two-plan pricing")}${row("c2", "Churn email")}</ul></div></div></div>`;

/** What X's own controls received, in order: the text typed into X's field, then each press. */
const inX: Array<string> = [];
const drawX = () => {
  document.body.insertAdjacentHTML("beforeend", `<div id="x">${PAGE}</div>`);
  const field = document.querySelector<HTMLTextAreaElement>("#x textarea")!;
  field.addEventListener("input", () => {
    inX.push(`typed ${field.value}`);
    const voice = document.querySelector('#x [aria-label="Voice mode"]');
    if (voice === null || field.value === "") return;
    voice.outerHTML = `<button aria-label="Send"><svg></svg></button>`;
    document.querySelector('#x [aria-label="Send"]')!.addEventListener("click", () => {
      inX.push("send");
      document
        .querySelector('#x [role="region"] .space-y-4')!
        .insertAdjacentHTML("beforeend", turn("u2", field.value, "Dev Rao quotes it most."));
      field.value = "";
    });
  });
  const history = document.querySelector<HTMLButtonElement>('#x [aria-haspopup="dialog"]')!;
  history.addEventListener("click", () => {
    const open = document.querySelector('#x [role="dialog"]');
    if (open === null) document.querySelector("#x")!.insertAdjacentHTML("beforeend", HISTORY);
    else open.remove();
    history.setAttribute("aria-expanded", String(open === null));
    for (const b of document.querySelectorAll('#x [role="dialog"] [aria-label="Delete"]'))
      b.addEventListener("click", () => inX.push("delete"));
  });
  return { [Symbol.dispose]: () => document.querySelector("#x")?.remove() };
};

// The engine: every script runs in X's page, here this document's #x, as X's at /i/grok.
registerXWebview({
  loadURL: async () => {},
  getURL: () => "https://x.com/i/grok",
  executeJavaScript: (code: string) =>
    Promise.resolve(new Function(`return ${code.replaceAll("location.pathname", '"/i/grok"')}`)()),
} as unknown as XWebview);
markXReady();

vi.spyOn(Route, "useSearch").mockImplementation(
  () => useLocation({ select: (l) => l.search }) as ReturnType<typeof Route.useSearch>,
);
const Grok = Route.options.component!;
const ui = () => (
  <div style={{ height: 800, display: "flex" }}>
    <Grok />
  </div>
);
const service = {
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
  "leads.peopleList": () =>
    Effect.succeed({
      people: [],
      total: 0,
      counts: { new: 0, contacted: 0, replied: 0, customer: 0, ignored: 0 },
      offset: 0,
    }),
};

it("draws X's conversation and history, and asks Grok only through X's own composer and Send", async () => {
  using _x = drawX();
  await using screen = await render(ui(), { router: "/grok", service });
  await expect.element(screen.getByText("Who is behind two-plan pricing?")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Churn email" })).toBeVisible();
  // The person Grok named, with the user's own Track for them.
  await expect.element(screen.getByRole("button", { name: "Track" })).toBeVisible();
  expect(inX).toEqual([]);

  const box = screen.getByRole("textbox", { name: "Ask Grok" });
  await userEvent.fill(box, "Who is quoting this?");
  expect(inX).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  await expect.element(screen.getByText("Dev Rao quotes it most.")).toBeVisible();
  expect(inX).toEqual(["typed Who is quoting this?", "send"]);
  await expect.element(box).toHaveValue("");
});

it("deletes a chat in X only once the user confirms it beside the row, as X asks", async () => {
  using _x = drawX();
  inX.length = 0;
  await using screen = await render(ui(), { router: "/grok", service });
  const rail = screen.getByRole("complementary", { name: "Grok rail" });
  await expect.element(rail.getByRole("button", { name: "Churn email" })).toBeVisible();
  await userEvent.hover(rail.getByRole("button", { name: "Churn email" }));
  await userEvent.click(rail.getByRole("button", { name: "Delete" }));
  expect(inX).toEqual([]);
  await userEvent.click(rail.getByRole("button", { name: "Delete" }));
  await expect.poll(() => inX).toEqual(["delete"]);
});
