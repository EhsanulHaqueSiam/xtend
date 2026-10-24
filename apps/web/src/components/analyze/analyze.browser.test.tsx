import type { AccountPost, CompetitorReport, NonPublic, WatchEntry } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { NOT_A_HANDLE } from "../../lib/utils";
import { Competitors } from "./Competitors";
import { PostsTable } from "./PostsTable";

const DAY_MS = 86_400_000;
const noPrivate: NonPublic = { lastRun: null, byPost: [] };

/** A post `daysAgo` old whose engagement rate is `likes` per 1000 views. */
const post = (postId: string, likes: number, daysAgo = 1): AccountPost => ({
  postId,
  url: `https://x.com/siamships/status/${postId}`,
  text: `post ${postId}`,
  createdAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  kind: "text",
  views: 1000,
  likes,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
});

it("with fewer than ten posts the best five stay green and only the rest turn red", async () => {
  // Seven posts: 7% down to 1% engagement; the oldest is outside the 30-day metrics window.
  const posts = [7, 6, 5, 4, 3, 2, 1].map((likes) =>
    post(String(likes), likes * 10, likes === 1 ? 40 : 1),
  );
  await using screen = await render(<PostsTable posts={posts} nonPublic={noPrivate} />, {
    service: { "costs.quote": quoting() },
  });
  const row = (id: string) => screen.getByRole("row").filter({ hasText: `post ${id}` });
  await expect.element(row("7")).toHaveClass("text-success-foreground");
  await expect.element(row("3")).toHaveClass("text-success-foreground");
  await expect.element(row("3")).not.toHaveClass("text-error-foreground");
  await expect.element(row("2")).toHaveClass("text-error-foreground");
  await expect.element(row("1")).toHaveClass("text-error-foreground");
  // One private-metrics read per post of the last 30 days: six at $0.005.
  await expect.element(screen.getByRole("button", { name: "Fetch now ($0.03)" })).toBeVisible();
});

const watched = (handle: string): WatchEntry => ({
  handle,
  addedAt: "2026-10-20T00:00:00.000Z",
  score: null,
  tier: null,
  change: { d1: null, d7: null, d14: null, d30: null },
});

it("fetches one competitor at a time, and refuses a typo before it reaches the service", async () => {
  const fetched: Array<string> = [];
  let release = () => {};
  const firstFetch = new Promise<void>((resolve) => (release = resolve));
  let reports: ReadonlyArray<CompetitorReport> = [];
  await using screen = await render(<Competitors posts={[post("1", 50)]} nonPublic={noPrivate} />, {
    service: {
      "costs.quote": quoting(() => paid(0.00097)),
      "scores.watchList": () => Effect.succeed([watched("levelsio"), watched("paulg")]),
      "analyze.competitors": () => Effect.sync(() => reports),
      "analyze.competitorFetch": ({ handle }) =>
        Effect.promise(() => firstFetch).pipe(
          Effect.map(() => {
            fetched.push(handle);
            const report = {
              handle,
              fetchedAt: "2026-10-23T00:00:00.000Z",
              profile: null,
              avgViews: 2000,
              topPosts: [],
            };
            reports = [report];
            return report;
          }),
        ),
    },
  });
  const fetches = screen.getByRole("button", { name: "Fetch ($0.00097)" });
  await expect.poll(() => fetches.elements().length).toBe(2);
  await userEvent.click(fetches.nth(0));
  // Paid reads: the other handle's Fetch waits rather than paying while this one runs.
  await expect.element(fetches.nth(0)).toBeDisabled();
  await expect.element(fetches.nth(1)).toBeDisabled();
  release();
  await expect.element(screen.getByRole("button", { name: "Refetch ($0.00097)" })).toBeVisible();
  expect(fetched).toEqual(["levelsio"]);
  // Own average 1000 views against their 2000.
  await expect.element(screen.getByText("50%")).toBeVisible();

  await userEvent.fill(screen.getByPlaceholder("handle without @"), "levels io");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  await expect.element(screen.getByText(NOT_A_HANDLE)).toBeVisible();
});
