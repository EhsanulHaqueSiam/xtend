import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's Chat on the desktop, with mock X's chat embed as the engine: an open shadow root in
 * X's markup that the engine reads, and X's passcode screen, which only the user answers in X.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine();
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname");
const rows = (engine = e) => engine.app.locator('main [data-x="chat-row"]');
const pane = (engine = e) =>
  engine.app.locator('section[aria-label="x.com"]').getAttribute("data-mode");
const link = (id: string) => `/i/chat/${id.replace(":", "-")}`;

test("Chat lists X's inbox from X's page and opens a conversation only for the user's click", async () => {
  const { conversations } = e.mock.state.chat;
  await e.app.getByRole("button", { name: "Chat", exact: true }).click();
  await expect.poll(enginePath).toBe("/i/chat");
  await expect.poll(() => rows().count()).toBe(conversations.length);
  expect(await rows().allTextContents()).toEqual(
    conversations.map((c) => expect.stringContaining(c.name)),
  );
  await e.app.getByText("Message Requests").waitFor();
  // The inbox alone opens nothing: X marks a conversation read once it is open.
  expect(e.mock.state.chat.opened).toEqual([]);

  const [first] = conversations;
  await rows().first().click();
  await expect.poll(enginePath).toBe(link(first!.id));
  const messages = e.app.locator('main [data-x="chat-message"]');
  await expect.poll(() => messages.count()).toBe(first!.messages.length);
  expect(await messages.first().textContent()).toContain(first!.messages[0]!.text);
  await e.app.getByText("Photo").waitFor();
  await e.app.getByText("👍 2").waitFor();
  expect(e.mock.state.chat.opened).toEqual([link(first!.id)]);

  // Back on the inbox, X leaves the conversation for its inbox.
  await e.app.getByRole("tab", { name: "All" }).click();
  await expect.poll(enginePath).toBe("/i/chat");
  // X's own search lists X's matches.
  await e.app.getByRole("textbox", { name: "Search" }).fill(conversations[2]!.name);
  await expect
    .poll(() => rows().allTextContents())
    .toEqual([expect.stringContaining(conversations[2]!.name)]);
  await e.app.getByRole("textbox", { name: "Search" }).fill("");
  await expect.poll(() => rows().count()).toBe(conversations.length);
  expect(e.mock.state.chat.opened).toEqual([link(first!.id)]);
});

test("a reload that brings a conversation back opens nothing in X: X shows its inbox", async () => {
  const { conversations, opened } = e.mock.state.chat;
  const before = [...opened];
  await go(`/chat?c=${encodeURIComponent(link(conversations[1]!.id))}`);
  await e.app.reload();
  await expect.poll(() => rows().count()).toBe(conversations.length);
  await e.app.getByRole("heading", { name: "Select a message" }).waitFor();
  expect([await enginePath(), opened]).toEqual(["/i/chat", before]);
});

test("Requests lists X's message requests, and Other the ones X files away", async () => {
  await go("/chat?tab=requests");
  await expect.poll(enginePath).toBe("/i/chat/requests");
  await expect
    .poll(() => rows().allTextContents())
    .toEqual(e.mock.state.chat.requests.map((r) => expect.stringContaining(r.name)));
  await e.app.getByRole("tab", { name: "Other" }).click();
  await expect.poll(enginePath).toBe("/i/chat/requests/other");
  await expect
    .poll(() => rows().allTextContents())
    .toEqual(e.mock.state.chat.other.map((r) => expect.stringContaining(r.name)));
});

test("X's passcode screen shows over the main area for the user to type, then Chat reads X's inbox", async () => {
  const locked = await startEngine({ chatLocked: true });
  try {
    await locked.app.evaluate(() => void (location.hash = "#/chat"));
    await expect.poll(() => locked.engine<string>("location.pathname")).toBe("/i/chat");
    await expect.poll(() => pane(locked)).toBe("main");
    expect(await rows(locked).count()).toBe(0);
    // The user types X's passcode in X's own page.
    await locked.engine(`(() => {
    const root = document.querySelector('[data-testid="xchatEmbedRoute"]').shadowRoot;
    for (const input of root.querySelectorAll('[data-testid="pin-code-input-container"] input')) {
      input.value = "4";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  })()`);
    await expect.poll(() => pane(locked)).not.toBe("main");
    await expect.poll(() => rows(locked).count()).toBe(locked.mock.state.chat.conversations.length);
    expect(locked.mock.state.chat.opened).toEqual([]);
  } finally {
    await locked.close();
  }
});
