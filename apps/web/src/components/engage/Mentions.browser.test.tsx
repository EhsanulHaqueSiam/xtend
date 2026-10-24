import {
  Costs_METHODS,
  Engage_METHODS,
  WS_METHODS,
  type Mention,
  type RateCard,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { render } from "../../../test/render";
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

const rates: RateCard = {
  post: 0.015,
  postWithLink: 0.2,
  like: 0.015,
  repost: 0.015,
  follow: 0.015,
  dm: 0.015,
  delete: 0.01,
  readPage: 0.005,
  profile: 0.01,
  searchPage: 0.00075,
  scraperProfile: 0.00022,
  followersPage: 0.001,
  trending: 0.001,
};

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
        monthlyBudgetUsd: 50,
        sessionPostingEnabled: false,
        dailyLibraryJobs: false,
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
    [Engage_METHODS.mentionHandled]: ({ postId }) => Effect.sync(() => void handled.add(postId)),
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
