import type { ObservedPostSummary } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SeenFeed } from "./SeenFeed";

const seen: ObservedPostSummary = {
  postId: "555",
  text: "shipping beats planning",
  author: { userId: "1", handle: "levelsio", name: "Pieter", verified: false, followers: 1000 },
  createdAt: "2026-10-23T00:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 5000, likes: 200, reposts: 10, replies: 5, quotes: 1, bookmarks: 3 },
  observations: 2,
  firstSeenAt: "2026-10-23T00:00:00.000Z",
  lastSeenAt: "2026-10-23T01:00:00.000Z",
};

it("opens a seen post from the keyboard: its row takes focus and Enter", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  onTestFinished(() => open.mockRestore());
  await using screen = await render(<SeenFeed />, {
    service: {
      "observations.listRecent": () => Effect.succeed({ posts: [seen] }),
    },
  });
  const row = screen.getByRole("row").filter({ hasText: "shipping beats planning" });
  (row.element() as HTMLElement).focus();
  await expect.element(row).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(open).toHaveBeenCalledWith("https://x.com/levelsio/status/555", "_blank", "noreferrer");
});
