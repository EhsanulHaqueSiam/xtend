import "../../index.css";
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { fakeTimers, render } from "../../../test/render";
import type { XWebview } from "../../state/x";

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
 * The engine: reads run in X's page, here this document; every other step (X's router) is only
 * recorded, as the URL it would move X's page to.
 */
const moves: Array<string> = [];
/** Each query typed into X's own search, "" for X's close. */
const searches: Array<string> = [];
registerXWebview({
  loadURL: async () => {},
  getURL: () => `https://x.com${moves.at(-1) ?? "/home"}`,
  executeJavaScript: (code: string) => {
    // X's path is where the engine last moved it; this document's own is the test runner's.
    if (code.includes("MutationObserver"))
      return Promise.resolve(
        new Function(
          `return ${code.replaceAll("location.pathname", JSON.stringify(moves.at(-1) ?? "/home"))}`,
        )(),
      );
    const to = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
    if (to !== undefined) moves.push(to);
    const query = /if \((".*?") === ""\)/.exec(code)?.[1];
    if (code.includes("dm-search-close") && query !== undefined)
      searches.push(JSON.parse(query) as string);
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
