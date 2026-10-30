// The stacked layout is container queries; without the stylesheet every width looks wide.
import "../index.css";

import type { ObservationListRecentInput, ObservedPostSummary } from "@xtend/contracts";
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
      "observations.listRecent": () => Effect.succeed({ posts: [seen], hasOlder: false }),
    },
  });
  const row = screen.getByRole("row").filter({ hasText: "shipping beats planning" });
  (row.element() as HTMLElement).focus();
  await expect.element(row).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(open).toHaveBeenCalledWith("https://x.com/levelsio/status/555", "_blank", "noreferrer");
});

it("stacks rows under 720px so the text and every number fit beside the X panel", async () => {
  const box = (width: number) => {
    const el = document.createElement("div");
    el.style.width = `${width}px`;
    return el;
  };
  const service = {
    "observations.listRecent": () => Effect.succeed({ posts: [seen], hasOlder: false }),
  };
  {
    await using narrow = await render(<SeenFeed />, { container: box(440), service });
    const save = narrow.getByRole("button", { name: /Save/ });
    await expect.element(save).toBeVisible();
    // Nothing falls off the right edge, and each number says what it is.
    expect(save.element().getBoundingClientRect().right).toBeLessThanOrEqual(
      narrow.container.getBoundingClientRect().right,
    );
    await expect.element(narrow.getByText("4.4% ER")).toBeVisible();
    await expect.element(narrow.getByText("Reposts", { exact: true })).not.toBeVisible();
  }
  await using wide = await render(<SeenFeed />, { container: box(1000), service });
  await expect.element(wide.getByRole("button", { name: /Save/ })).toBeVisible();
  await expect.element(wide.getByText("Reposts", { exact: true })).toBeVisible();
});

it("keeps Newer available when an older page is empty", async () => {
  await using screen = await render(<SeenFeed />, {
    service: {
      "observations.listRecent": (input) =>
        Effect.succeed(
          input.before === undefined
            ? { posts: [seen], hasOlder: true }
            : { posts: [], hasOlder: false },
        ),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Older" }));
  await expect.element(screen.getByText("No seen post matches.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Newer" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Older" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Newer" }));
  await expect.element(screen.getByText(seen.text)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Newer" })).toBeDisabled();
});

it("pages older by cursor and narrows by text and by a clicked author", async () => {
  const older: ObservedPostSummary = { ...seen, postId: "444", text: "older take" };
  const asked: Array<ObservationListRecentInput> = [];
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  onTestFinished(() => open.mockRestore());
  await using screen = await render(<SeenFeed />, {
    service: {
      "observations.listRecent": (input) => {
        asked.push(input);
        return Effect.succeed(
          input.before === undefined
            ? { posts: [seen], hasOlder: true }
            : { posts: [older], hasOlder: false },
        );
      },
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Older" }));
  await expect.element(screen.getByText("older take")).toBeVisible();
  expect(asked.at(-1)?.before).toEqual({
    lastSeenAt: seen.lastSeenAt,
    createdAt: seen.createdAt,
    postId: "555",
  });
  await expect.element(screen.getByRole("button", { name: "Older" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Newer" }));
  await expect.element(screen.getByText("shipping beats planning")).toBeVisible();

  // The handle filters to its author instead of opening the post.
  await userEvent.click(screen.getByRole("button", { name: "@levelsio" }));
  await expect
    .element(screen.getByRole("button", { name: "Clear author @levelsio" }))
    .toBeVisible();
  expect(open).not.toHaveBeenCalled();
  await userEvent.fill(screen.getByLabelText("Search seen posts"), "ship");
  await expect
    .poll(() => asked.at(-1))
    .toEqual({ limit: 100, query: "ship", authorHandle: "levelsio" });
});
