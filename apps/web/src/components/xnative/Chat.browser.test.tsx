import "../../index.css";
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { fakeTimers, render } from "../../../test/render";
import type { XWebview } from "../../state/x";
import { Toasts } from "../ui/toast";

// The screen reads the bridge at module load (env.ts), so it is imported after the bridge exists.
installFakeBridge();
const { Route } = await import("../../routes/chat");
const { markXReady, registerXWebview, xOverAtom } = await import("../../state/x");

const icon = (name: string) => `<svg data-icon="${name}"></svg>`;
const row = (id: string, name: string, preview: string, marks = "") =>
  `<div data-testid="dm-conversation-item-${id}"><a href="/i/chat/${id.replace(":", "-")}"><div data-inbox-row=""><div class="py-3"><img src="https://pbs.twimg.com/profile_images/1/a.jpg"></div><div><div><div><span>${name}</span></div><div><span>2m</span></div></div><div><div><span>${preview}</span></div><div>${marks.includes("unread") ? icon("icon-circle-fill") : ""}</div></div></div></div></a></div>`;
// X's chat embed (pin-page-rweb) on X's page, as the engine page holds it.
const INBOX = `<div data-testid="dm-inbox-panel"><div data-testid="dm-search-bar"><input data-testid="dm-search-input"></div><div data-testid="dm-conversation-scroller">
  <div data-testid="dm-message-requests-list-item"><a href="/i/chat/requests" data-testid="dm-message-requests-inbox-row"><div data-inbox-row=""><div class="py-3"></div><div><div><div><span>Message Requests</span></div></div><div><div><span>Bo and 2 others</span></div></div></div></div></a></div>
  ${row("11:22", "Ann", "See you at 6", "unread")}${row("11:33", "Cy", "You: Thanks!")}</div></div>`;
const CONVERSATION = `<div data-testid="dm-conversation-panel"><span data-testid="dm-conversation-username">Ann</span><div data-testid="dm-message-list">
  <div class="justify-end" data-testid="message-m1" data-send-status="sent"><span hidden id=":r1:-sender">You</span><span hidden id=":r1:-time">5:04 PM</span><div data-testid="message-text-m1"><span>Yes, after work</span></div></div>
  <div class="justify-start" data-testid="message-m2" data-send-status="sent"><span hidden id=":r2:-sender">Ann</span><span hidden id=":r2:-kind">Photo</span></div>
  <div class="justify-start" data-testid="message-m3" data-send-status="sent"><span hidden id=":r3:-sender">Ann</span><div data-testid="message-text-m3"><span>See you at 6</span></div><div style="grid-area: message-info"><button><div><span>👍</span></div><span>2</span></button></div></div>
</div></div>`;
// X's search in place of its inbox, listing its matches by their conversation's link.
const SEARCH = `<div data-testid="dm-inbox-panel"><div data-testid="dm-search-bar"><input data-testid="dm-search-input" value="Ann"><button data-testid="dm-search-close"></button></div><div role="listbox"><a id="dm-search-conversation-option-r1" role="option" href="/i/chat/11-22"><div class="size-14"><img src="https://pbs.twimg.com/profile_images/1/a.jpg"></div><div><span>Ann</span></div><span>@ann</span></a></div></div>`;
const PIN = `<h1 data-testid="pin-title">Enter your passcode</h1><div data-testid="pin-code-input-container"><input><input><input><input></div>`;

/** X's page in this document: X's chat host and its open shadow root drawing `markup`. */
let root: ShadowRoot | null = null;
const drawX = (markup: string) => {
  if (root === null) {
    const host = document.createElement("div");
    host.dataset.testid = "xchatEmbedRoute";
    document.body.append(host);
    root = host.attachShadow({ mode: "open" });
  }
  root.innerHTML = markup;
};

/**
 * The engine: reads and X's search run in X's page, here this document; every other step (X's
 * router) is only recorded, as the URL it would move X's page to.
 */
const moves: Array<string> = [];
/** Each query typed into X's own search, "" for X's close. */
const searches: Array<string> = [];
/** Each time X's conversation was scrolled up for older messages. */
let olderScrolls = 0;
registerXWebview({
  loadURL: async () => {},
  getURL: () => `https://x.com${moves.at(-1) ?? "/home"}`,
  executeJavaScript: (code: string) => {
    const query = /const query = (".*?");/.exec(code)?.[1];
    if (code.includes("scrollBy") && code.includes('"dm-message-list"')) olderScrolls++;
    if (code.includes("dm-search-close") && query !== undefined)
      searches.push(JSON.parse(query) as string);
    // X's path is where the engine last moved it; this document's own is the test runner's.
    // Every script on X's chat runs here, and presses too (`__xtendPress` marks each one).
    if (code.includes("xchatEmbed") || code.includes("__xtendPress"))
      return Promise.resolve(
        new Function(
          `return ${code.replaceAll("location.pathname", JSON.stringify(moves.at(-1) ?? "/home"))}`,
        )(),
      );
    const to = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
    if (to !== undefined) moves.push(to);
    return Promise.resolve(true);
  },
} as unknown as XWebview);
markXReady();

// The route reads its own search; the test router has only a root, so it is read from there.
vi.spyOn(Route, "useSearch").mockImplementation(() => ({
  tab: "all",
  ...(useLocation({ select: (l) => l.search }) as Partial<ReturnType<typeof Route.useSearch>>),
}));
const Chat = Route.options.component!;

function Over() {
  return <span data-testid="over">{String(useAtomValue(xOverAtom))}</span>;
}
const ui = () => (
  <div style={{ height: 700, display: "flex" }}>
    <Over />
    <Chat />
  </div>
);

it("draws X's inbox from X's page, opens a conversation only for the user's click, and leaves it for the inbox", async () => {
  drawX(INBOX);
  await using screen = await render(ui(), { router: "/chat", service: {} });
  await expect.element(screen.getByRole("button", { name: /Ann.*See you at 6/ })).toBeVisible();
  await expect.element(screen.getByText("Bo and 2 others")).toBeVisible();
  expect(moves).toEqual(["/i/chat"]);

  await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  // X opens it and draws the conversation; its inbox is gone from X's narrow page.
  drawX(CONVERSATION);
  await expect.element(screen.getByText("Yes, after work")).toBeVisible();
  await expect.element(screen.getByText("Photo")).toBeVisible();
  await expect.element(screen.getByText("👍 2")).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Ann" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /Cy/ })).toBeVisible();
  // Only the click opened a conversation; back on the inbox, X goes back to its inbox.
  expect(moves.filter((m) => m.startsWith("/i/chat/"))).toEqual(["/i/chat/11-22"]);
  await userEvent.click(screen.getByRole("tab", { name: "All" }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat");
  // Another conversation, at its top as well: X is asked for its older messages too.
  await expect.poll(() => olderScrolls).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: /Cy/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-33");
  drawX(CONVERSATION.replaceAll("m1", "m4").replace("Yes, after work", "Tomorrow then"));
  await expect.element(screen.getByText("Tomorrow then")).toBeVisible();
  await expect.poll(() => olderScrolls).toBe(2);
});

it("shows X's passcode screen over the main area until X opens its chats", async () => {
  drawX(PIN);
  await using screen = await render(ui(), { router: "/chat", service: {} });
  await expect.element(screen.getByTestId("over")).toHaveTextContent("true");
  drawX(INBOX);
  await expect.element(screen.getByTestId("over")).toHaveTextContent("false");
  await expect.element(screen.getByRole("button", { name: /Ann/ })).toBeVisible();
});

it("opens no conversation the route brings back (a reload, Back or Forward), only the one clicked", async () => {
  moves.length = 0;
  drawX(INBOX);
  await using screen = await render(ui(), { router: "/chat?c=%2Fi%2Fchat%2F11-22", service: {} });
  await expect.element(screen.getByRole("button", { name: /Ann/ })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Select a message" })).toBeVisible();
  expect(moves).toEqual(["/i/chat"]);

  await userEvent.click(screen.getByRole("button", { name: /Cy/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-33");
  screen.router!.history.back();
  await expect.poll(() => moves.at(-1)).toBe("/i/chat");
  drawX(INBOX);
  screen.router!.history.forward();
  await expect
    .poll(() => screen.router!.state.location.search)
    .toMatchObject({ c: "/i/chat/11-33" });
  await expect.element(screen.getByRole("heading", { name: "Select a message" })).toBeVisible();
  expect(moves.filter((m) => m.startsWith("/i/chat/"))).toEqual(["/i/chat/11-33"]);
});

it("presses nothing in X's search without a query, and undoes only a query it typed", async () => {
  searches.length = 0;
  drawX(INBOX);
  using _timers = fakeTimers();
  await using idle = await render(ui(), { router: "/chat", service: {} });
  await vi.advanceTimersByTimeAsync(1_000);
  await idle.unmount();
  expect(searches).toEqual([]);

  await using screen = await render(ui(), { router: "/chat", service: {} });
  const box = screen.getByRole("textbox", { name: "Search" });
  await userEvent.fill(box, "Ann");
  await vi.advanceTimersByTimeAsync(300);
  // Cleared in Xtend, X's search closes; leaving Chat with a query open closes it too.
  await userEvent.fill(box, "");
  await vi.advanceTimersByTimeAsync(300);
  await userEvent.fill(box, "Cy");
  await vi.advanceTimersByTimeAsync(300);
  await screen.unmount();
  expect(searches).toEqual(["Ann", "", "Cy", ""]);
});

it("leaves the search for the inbox once a result opens, since X's conversation page draws no search", async () => {
  moves.length = 0;
  searches.length = 0;
  drawX(INBOX);
  await using screen = await render(ui(), { router: "/chat", service: {} });
  await userEvent.fill(screen.getByRole("textbox", { name: "Search" }), "Ann");
  await expect.poll(() => searches).toEqual(["Ann"]);
  drawX(SEARCH);
  await userEvent.click(screen.getByRole("button", { name: /Ann.*@ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  drawX(CONVERSATION);
  await expect.element(screen.getByText("Yes, after work")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /Cy/ })).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Search" })).toHaveValue("");
});

it("searches from an open conversation in X's inbox, where X draws its search, and says so when X draws none", async () => {
  moves.length = 0;
  drawX(INBOX);
  await using screen = await render(ui(), { router: "/chat", service: {} });
  await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  // X's conversation page draws no search field.
  drawX(CONVERSATION);
  await expect.element(screen.getByText("Yes, after work")).toBeVisible();
  const box = screen.getByRole("textbox", { name: "Search" });
  await userEvent.fill(box, "Cy");
  await expect.poll(() => moves.at(-1)).toBe("/i/chat");
  drawX(INBOX);
  await expect
    .poll(() => root?.querySelector<HTMLInputElement>('[data-testid="dm-search-input"]')?.value)
    .toBe("Cy");

  // X draws no search at all: a plain line, not a wait.
  drawX("<div></div>");
  await userEvent.fill(box, "Dee");
  await expect.element(screen.getByText("X shows no chat search right now.")).toBeVisible();
});

it("sends through X's own composer and Send, and keeps the user's text when X could not send it", async () => {
  drawX(INBOX);
  await using screen = await render(
    <>
      {ui()}
      <Toasts />
    </>,
    {
      router: "/chat",
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
      },
    },
  );
  await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  // X's composer: its Send adds the message as the user's, marked as X's page marks it.
  drawX(
    CONVERSATION.replace(
      /<\/div><\/div>$/,
      `</div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea><button data-testid="dm-composer-send-button">Send</button></div></div>`,
    ),
  );
  let status = "failed";
  const field = root!.querySelector("textarea")!;
  root!.querySelector('[data-testid="dm-composer-send-button"]')!.addEventListener("click", () => {
    const id = `n${root!.querySelectorAll('[data-testid^="message-n"]').length}`;
    root!
      .querySelector('[data-testid="dm-message-list"]')!
      .insertAdjacentHTML(
        "beforeend",
        `<div class="justify-end" data-testid="message-${id}" data-send-status="${status}"><div data-testid="message-text-${id}"><span>${field.value}</span></div></div>`,
      );
    field.value = "";
  });
  const box = screen.getByRole("textbox", { name: "Message" });
  await userEvent.fill(box, "Running late");
  await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  await expect.element(screen.getByText("Message failed to send")).toBeVisible();
  await expect.element(box).toHaveValue("Running late");
  // The message X kept shows as X marks it.
  await expect.element(screen.getByText("Failed to send")).toBeVisible();

  status = "sent";
  await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
  await expect.element(box).toHaveValue("");
  expect(
    [...root!.querySelectorAll('[data-testid^="message-text-n"]')].map((m) => m.textContent),
  ).toEqual(["Running late", "Running late"]);
});

it("holds what the user sent until X marks it, across another conversation, with every Send and Reply waiting", async () => {
  drawX(INBOX);
  await using screen = await render(
    <>
      {ui()}
      <Toasts />
    </>,
    {
      router: "/chat",
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
      },
    },
  );
  // X's conversation with its composer: its Send adds the user's message, still sending.
  const withComposer = CONVERSATION.replace(
    /<\/div><\/div>$/,
    `</div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea><button data-testid="dm-composer-send-button">Send</button></div></div>`,
  );
  const open = async (name: RegExp, path: string) => {
    await userEvent.click(screen.getByRole("button", { name }));
    await expect.poll(() => moves.at(-1)).toBe(path);
    drawX(withComposer);
    await expect.element(screen.getByRole("textbox", { name: "Message" })).toBeVisible();
  };
  await open(/Ann/, "/i/chat/11-22");
  const field = root!.querySelector("textarea")!;
  root!.querySelector('[data-testid="dm-composer-send-button"]')!.addEventListener("click", () => {
    root!
      .querySelector('[data-testid="dm-message-list"]')!
      .insertAdjacentHTML(
        "beforeend",
        `<div class="justify-end" data-testid="message-n0" data-send-status="pending"><div data-testid="message-text-n0"><span>${field.value}</span></div></div>`,
      );
    field.value = "";
  });
  const box = screen.getByRole("textbox", { name: "Message" });
  await userEvent.fill(box, "Running late");
  {
    // From here, how long Xtend waits for X's mark passes at once.
    using _timers = fakeTimers();
    await userEvent.click(screen.getByRole("button", { name: "Send", exact: true }));
    await vi.advanceTimersByTimeAsync(20_000);
  }
  await expect.element(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect.element(box).toHaveValue("Running late");

  // Another conversation waits for it too, and the first keeps its text for the user's return.
  await open(/Cy/, "/i/chat/11-33");
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Reply", exact: true }).first())
    .toBeDisabled();
  await open(/Ann/, "/i/chat/11-22");
  await expect.element(box).toHaveValue("Running late");
  // X's own page answers: marked sent, the draft goes.
  root!
    .querySelector('[data-testid="dm-message-list"]')!
    .insertAdjacentHTML(
      "beforeend",
      `<div class="justify-end" data-testid="message-n0" data-send-status="sent"><div data-testid="message-text-n0"><span>Running late</span></div></div>`,
    );
  await expect.element(box).toHaveValue("");
  await expect.element(box).toBeEnabled();
});

it("offers no composer of its own on a conversation without a message X drew, only X's page to write the first", async () => {
  drawX(INBOX);
  await using screen = await render(ui(), { router: "/chat", service: {} });
  await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  drawX(
    `<div data-testid="dm-conversation-panel"><span data-testid="dm-conversation-username">Ann</span><div data-testid="dm-message-list"></div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea></div></div>`,
  );
  await expect
    .element(screen.getByRole("button", { name: "Write the first message in X" }))
    .toBeVisible();
  expect(screen.getByRole("textbox", { name: "Message" }).elements()).toHaveLength(0);
});

it("starts an edit from the text X loads into its own editor, not from what X displays", async () => {
  drawX(INBOX);
  await using screen = await render(ui(), {
    router: "/chat",
    service: {
      "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /Ann/ }));
  await expect.poll(() => moves.at(-1)).toBe("/i/chat/11-22");
  // X displays "Yes, after work"; its editor holds the whole message, markdown X hides included.
  const full = "Yes, after work **today**";
  // X slow to load its editor, the second time.
  let slow = false;
  let loaded = false;
  drawX(
    `<div data-testid="dm-conversation-panel"><span data-testid="dm-conversation-username">Ann</span><div data-testid="dm-message-list"><div class="justify-end" data-testid="message-m1" data-send-status="sent"><span hidden id=":r1:-sender">You</span><div role="article"><div data-testid="message-text-m1"><span>Yes, after work</span></div></div></div></div><div data-testid="dm-composer-container"><textarea data-testid="dm-composer-textarea"></textarea><button data-testid="dm-composer-send-button">Send</button></div></div>`,
  );
  const field = root!.querySelector("textarea")!;
  root!.addEventListener("mouseover", () => {
    if (!root!.querySelector('[data-testid="message-overflow-button-m1"]'))
      root!
        .querySelector('[role="article"]')!
        .insertAdjacentHTML(
          "beforeend",
          '<button data-testid="message-overflow-button-m1"></button>',
        );
  });
  root!.addEventListener("click", (event) => {
    const el = event.target as Element;
    // X's "..." opens its menu, and closes it pressed again.
    const open = root!.querySelector('[role="menu"]');
    if (el.matches('[data-testid="message-overflow-button-m1"]') && open) open.remove();
    else if (el.matches('[data-testid="message-overflow-button-m1"]'))
      root!.append(
        Object.assign(document.createElement("div"), {
          role: "menu",
          innerHTML:
            '<div role="menuitem"><svg data-icon="icon-pencil-stroke"></svg>Edit message</div>',
        }),
      );
    if (el.closest('[role="menuitem"]')) {
      root!.querySelector('[role="menu"]')!.remove();
      const load = () => {
        field.insertAdjacentHTML(
          "beforebegin",
          '<div data-testid="dm-composer-edit-mode"><button data-testid="dm-composer-discard-edit-button"></button></div>',
        );
        field.value = full;
        loaded = slow;
      };
      if (slow) setTimeout(load, 800);
      else load();
    }
    if (el.matches('[data-testid="dm-composer-discard-edit-button"]')) {
      el.parentElement!.remove();
      field.value = "";
    }
  });
  const message = screen.getByText("Yes, after work");
  await expect.element(message).toBeVisible();
  await userEvent.hover(message);
  await userEvent.click(screen.getByRole("button", { name: "More", exact: true }).last());
  // Xtend's menu, in its own portal, beside X's own in X's page.
  await userEvent.click(
    page
      .getByRole("menu", { name: "Message actions" })
      .getByRole("menuitem", { name: "Edit message" }),
  );
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toHaveValue(full);
  await expect.element(screen.getByRole("button", { name: "Discard edit" })).toBeVisible();
  // X's composer is back as it was.
  expect([root!.querySelector('[data-testid="dm-composer-edit-mode"]'), field.value]).toEqual([
    null,
    "",
  ]);
  // The user types while X loads its editor: their text stays, the edit waits for another click.
  await userEvent.click(screen.getByRole("button", { name: "Discard edit" }));
  slow = true;
  await userEvent.hover(message);
  await userEvent.click(screen.getByRole("button", { name: "More", exact: true }).last());
  await userEvent.click(
    page
      .getByRole("menu", { name: "Message actions" })
      .getByRole("menuitem", { name: "Edit message" }),
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Hi");
  // X loaded its editor and Xtend put X's composer back: the user's text is what stays.
  await expect
    .poll(() => loaded && root!.querySelector('[data-testid="dm-composer-edit-mode"]'))
    .toBeNull();
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Hi");
});
