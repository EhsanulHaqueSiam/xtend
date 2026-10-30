import { Costs_METHODS, Engage_METHODS, WS_METHODS, type Mention } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { rates } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Toasts } from "../ui/toast";
import { Mentions } from "./Mentions";

const mention = (n: number, text: string): Mention => ({
  post: {
    postId: String(1980000000000000000n + BigInt(n)),
    url: `https://x.com/author${n}/status/${n}`,
    text,
    createdAt: new Date(Date.UTC(2026, 9, 24, 12 - n)).toISOString(),
    lang: "en",
    isReply: true,
    isRepost: false,
    hasMedia: false,
    hasLink: false,
    author: {
      userId: String(n),
      handle: `author${n}`,
      name: `Author ${n}`,
      followers: 1000,
      verified: false,
      avatarUrl: null,
    },
    metrics: { views: 100, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  },
  source: "session",
  handled: false,
});

/** Three open mentions; marking one handled drops it from the next read, as the service does. */
function fakeService(): FakeService {
  const handled = new Set<string>();
  const all = [
    mention(1, "first mention"),
    mention(2, "second mention"),
    mention(3, "third mention"),
  ];
  return {
    [WS_METHODS.settingsGet]: () =>
      Effect.succeed({
        handle: "me",
        tregTokenSet: true,
        assistProvider: "claude",
        assistBaseUrl: null,
        assistModel: "",
        assistBinaryPath: "",
        assistKeySet: false,
        monthlyBudgetUsd: 50,
        sessionPostingEnabled: false,
        dailyLibraryJobs: false,
        poolSharing: true,
        voiceNotes: "",
        keywords: [],
        timeZone: "UTC",
      }),
    [Costs_METHODS.quote]: ({ actions }) =>
      Effect.succeed({ rates, quotes: actions.map(() => ({ usd: 0.005, cached: false })) }),
    [Engage_METHODS.mentions]: () =>
      Effect.sync(() => ({
        mentions: all.map(({ post, source }) => ({
          post,
          source,
          handled: handled.has(post.postId),
        })),
        apiError: null,
      })),
    [Engage_METHODS.inbox]: () => Effect.succeed({ sent: [], followUps: [], incoming: [] }),
    [Engage_METHODS.mentionHandled]: ({ postIds, handled: done }) =>
      Effect.sync(() => postIds.forEach((id) => (done ? handled.add(id) : handled.delete(id)))),
    [Engage_METHODS.draftReply]: ({ tone }) =>
      Effect.succeed([{ text: `${tone ?? "plain"} one` }, { text: `${tone ?? "plain"} two` }]),
  };
}

it("marking the open mention handled moves the detail to the next one", async () => {
  await using screen = await render(<Mentions />, { service: fakeService() });
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("first mention")).toBeVisible();

  await userEvent.click(detail.getByRole("button", { name: "Mark handled" }));

  await expect.element(detail.getByText("second mention")).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: /Open/ })).toHaveTextContent("Open2");
});

it("j and k move the selection through the list", async () => {
  await using screen = await render(<Mentions />, { service: fakeService() });
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("first mention")).toBeVisible();

  await userEvent.keyboard("j");
  await userEvent.keyboard("j");
  await expect.element(detail.getByText("third mention")).toBeVisible();

  await userEvent.keyboard("k");
  await expect.element(detail.getByText("second mention")).toBeVisible();
});

it("a tone chip drafts in that taste, a candidate fills the editor, write my own clears", async () => {
  await using screen = await render(<Mentions />, { service: fakeService() });
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("first mention")).toBeVisible();

  await userEvent.click(detail.getByRole("button", { name: "Sarcastic" }));
  const editor = detail.getByRole("textbox");
  await expect.element(editor).toHaveValue("sarcastic one");
  await userEvent.click(detail.getByRole("button", { name: /sarcastic two/ }));
  await expect.element(editor).toHaveValue("sarcastic two");

  await userEvent.click(detail.getByRole("button", { name: "Write my own" }));
  await expect.element(detail.getByRole("list", { name: "Drafts" })).not.toBeInTheDocument();
  await expect.element(editor).toHaveValue("sarcastic two");
});

it("a handled mention reopens from All", async () => {
  await using screen = await render(<Mentions />, { service: fakeService() });
  const detail = screen.getByRole("complementary");
  const open = screen.getByRole("tab", { name: /Open/ });
  await userEvent.click(detail.getByRole("button", { name: "Mark handled" }));
  await expect.element(open).toHaveTextContent("Open2");

  await userEvent.click(screen.getByRole("tab", { name: /All/ }));
  await userEvent.click(screen.getByRole("button", { name: /first mention/ }));
  await userEvent.click(detail.getByRole("button", { name: "Reopen" }));
  await expect.element(open).toHaveTextContent("Open3");
});

it("checked rows are marked handled together, and Undo reopens them all", async () => {
  await using screen = await render(
    <>
      <Mentions />
      <Toasts />
    </>,
    { service: fakeService() },
  );
  const open = screen.getByRole("tab", { name: /Open/ });
  await expect.element(open).toHaveTextContent("Open3");

  await userEvent.click(screen.getByRole("checkbox", { name: "Pick Author 1" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Pick Author 3" }));
  await userEvent.click(screen.getByRole("button", { name: "Mark 2 handled" }));
  await expect.element(open).toHaveTextContent("Open1");
  await expect.element(screen.getByText(/2 marked handled/)).toBeVisible();
  // The bar goes once its rows are gone; the header actions are back.
  await expect.element(screen.getByRole("button", { name: /Fetch new/ })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await expect.element(open).toHaveTextContent("Open3");
});
