import type { Pick, XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { rates } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { PicksTab } from "./PicksTab";

const post = (postId: string, text: string, hasMedia: boolean): XPost => ({
  postId,
  url: `https://x.com/maya/status/${postId}`,
  text,
  createdAt: "2026-10-24T08:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost: false,
  hasMedia,
  hasLink: false,
  author: {
    userId: "9",
    handle: "maya",
    name: "Maya",
    followers: 48_000,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views: 120_000, likes: 900, reposts: 80, replies: 30, quotes: 4, bookmarks: 60 },
});

const pick = (p: XPost): Pick => ({ day: "2026-10-25", keyword: "ai", post: p, whyItWorks: null });

it("filters the picks by format, and a card's Save files it in the swipe file", async () => {
  const saves: Array<{ readonly postId: string; readonly collectionId: number | null }> = [];
  await using screen = await render(<PicksTab />, {
    service: {
      "library.picksGet": () =>
        Effect.succeed({
          day: "2026-10-25",
          keywords: ["ai"],
          pending: [],
          picks: [pick(post("1", "A text post", false)), pick(post("2", "A media post", true))],
        }),
      "library.staffPicks": () => Effect.succeed([]),
      "library.savedList": () => Effect.succeed([]),
      "library.collectionsList": () => Effect.succeed([]),
      "costs.quote": () => Effect.succeed({ rates, quotes: [] }),
      "library.save": ({ post: saved, collectionId }) => {
        saves.push({ postId: saved.postId, collectionId });
        return Effect.succeed({
          id: 1,
          post: saved,
          note: "",
          savedAt: "2026-10-25T09:00:00.000Z",
          collectionIds: [],
        });
      },
    },
  });

  await expect.element(screen.getByText("A text post")).toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: /^Media/ }));
  await expect.element(screen.getByText("A text post")).not.toBeInTheDocument();

  const card = screen.getByRole("article");
  await expect.element(card.getByText("A media post")).toBeVisible();
  await userEvent.hover(card);
  await userEvent.click(card.getByRole("button", { name: "Save", exact: true }));
  expect(saves).toEqual([{ postId: "2", collectionId: null }]);
  await expect.element(card.getByRole("button", { name: "Saved" })).toBeDisabled();
});
