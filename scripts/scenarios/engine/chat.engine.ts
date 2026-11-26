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
  // A result opened ends the search: its conversation opens, and the inbox shows again.
  await e.app.getByRole("textbox", { name: "Search" }).fill(conversations[2]!.name);
  await expect.poll(() => rows().count()).toBe(1);
  await rows().first().click();
  await expect.poll(enginePath).toBe(link(conversations[2]!.id));
  await expect.poll(() => rows().count()).toBe(conversations.length);
  expect(await e.app.getByRole("textbox", { name: "Search" }).inputValue()).toBe("");
  expect(e.mock.state.chat.opened).toEqual([link(first!.id), link(conversations[2]!.id)]);
  // From the open conversation, whose page has no search in X, X's inbox searches.
  await e.app.getByRole("textbox", { name: "Search" }).fill(conversations[1]!.name);
  await expect.poll(enginePath).toBe("/i/chat");
  await expect
    .poll(() => rows().allTextContents())
    .toEqual([expect.stringContaining(conversations[1]!.name)]);
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

const messages = () => e.app.locator('main [data-x="chat-message"]');
/** Runs `step` on X's own chat root in the engine page, as the user's hand there does. */
const inX = (step: string) =>
  e.engine(`(() => {
    const root = document.querySelector('[data-testid="xchatEmbedRoute"]').shadowRoot;
    ${step}
    return true;
  })()`);
const openConversation = async (name: string, list = "/chat") => {
  await go(list);
  await rows().filter({ hasText: name }).click();
  await messages().first().waitFor();
};

test("Send types into X's own composer and presses X's Send: X's sent message shows, and the composer empties", async () => {
  const c = e.mock.state.chat.conversations[1]!;
  await openConversation(c.name);
  await expect.poll(enginePath).toBe(link(c.id));
  const box = e.app.getByRole("textbox", { name: "Message" });
  await box.fill("On my way");
  await e.app.getByRole("button", { name: "Send", exact: true }).click();
  await messages().filter({ hasText: "On my way" }).waitFor();
  expect(await box.inputValue()).toBe("");
  expect([e.mock.state.chat.writes.at(-1), c.messages.at(-1)]).toEqual([
    "send s1",
    expect.objectContaining({ mine: true, text: "On my way" }),
  ]);
});

test("React lists X's own quick reactions from X's picker, and the one picked is X's", async () => {
  const c = e.mock.state.chat.conversations[0]!;
  await openConversation(c.name);
  const target = messages().filter({ hasText: "See you at 6 then" });
  await target.hover();
  await target.getByRole("button", { name: "React", exact: true }).click();
  const picker = e.app.getByRole("dialog");
  await expect
    .poll(() => picker.getByRole("button").allTextContents())
    .toEqual(["👍", "👎", "❤️", "😂", "🎉", "😮"]);
  // Reading X's picker presses nothing: it closed again in X's page.
  expect(await inX(`if (root.querySelector('[role="dialog"]')) throw new Error("open");`)).toBe(
    true,
  );
  await picker.getByRole("button", { name: "❤️" }).click();
  await target.getByText("❤️").waitFor();
  expect(e.mock.state.chat.writes.at(-1)).toBe("react m4");
});

test("Delete is X's own: X's confirm shows over the main area, and once the user confirms it there the message goes", async () => {
  const c = e.mock.state.chat.conversations[0]!;
  await openConversation(c.name);
  const target = messages().filter({ hasText: "Yes, after work" });
  await target.hover();
  await target.getByRole("button", { name: "More", exact: true }).click();
  await expect
    .poll(() => e.app.getByRole("menuitem").allTextContents())
    .toEqual([
      "Reply",
      "Forward",
      "Edit message",
      "Copy message text",
      "Info",
      "Delete for me",
      "Delete for all",
    ]);
  await e.app.getByRole("menuitem", { name: "Delete for me", exact: true }).click();
  await expect.poll(() => pane()).toBe("main");
  // Nothing is deleted until the user answers X's confirm, in X's page.
  expect(c.messages.map((m) => m.id)).toContain("m2");
  await inX(
    `[...root.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Delete for me").click();`,
  );
  await expect.poll(() => pane()).not.toBe("main");
  await expect.poll(() => target.count()).toBe(0);
  expect(e.mock.state.chat.writes.at(-1)).toBe("delete m2");
});

test("Accept answers X's message request with X's own Accept, after which the conversation takes messages", async () => {
  const request = e.mock.state.chat.requests[0]!;
  await openConversation(request.name, "/chat?tab=requests");
  await e.app.getByText(`Accept message requests from @${request.handle}`).waitFor();
  expect(await e.app.getByRole("textbox", { name: "Message" }).count()).toBe(0);
  await e.app.getByRole("button", { name: "Accept", exact: true }).click();
  await e.app.getByRole("textbox", { name: "Message" }).waitFor();
  expect(e.mock.state.chat.writes.at(-1)).toBe(`accept ${request.id}`);
});

test("More opens X's own page about the conversation over the main area, until X's Back returns to it", async () => {
  const c = e.mock.state.chat.conversations.find((x) => x.id.startsWith("g"))!;
  await openConversation(c.name);
  await e.app.getByRole("button", { name: "More", exact: true }).first().click();
  await expect.poll(enginePath).toBe(`${link(c.id)}/info`);
  await expect.poll(() => pane()).toBe("main");
  await inX(`root.querySelector('a[aria-label="Back"]').click();`);
  await expect.poll(() => pane()).not.toBe("main");
  expect(await enginePath()).toBe(link(c.id));
});
