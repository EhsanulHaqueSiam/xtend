import type { ObservationBatch } from "@xtend/contracts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

/** One home-timeline sighting of the same post, as the desktop's capture pipeline sends it. */
const sighting = (observedAt: string, views: number, likes: number): ObservationBatch => ({
  viewerHandle: null,
  source: "home",
  observedAt,
  posts: [
    {
      postId: "1980000000000000001",
      author: {
        userId: "5",
        handle: "levelsio",
        name: "Pieter",
        followers: 621000,
        verified: true,
      },
      text: "Shipped the thing.",
      createdAt: "2026-10-22T04:00:00.000Z",
      isReply: false,
      isRepost: false,
      isPromoted: false,
      hasMedia: false,
      hasLink: false,
      metrics: { views, likes, reposts: 12, replies: 4, quotes: 1, bookmarks: 9 },
    },
  ],
});

test("observations: posted batches show in Seen with the latest metrics and the sighting count", async () => {
  const { page, observe, rpc, treg } = app;
  await observe(sighting("2026-10-22T05:00:00.000Z", 1200, 30));
  await page.goto("/seen");
  const row = page.getByRole("row", { name: /Shipped the thing\./ });
  await row.getByRole("cell", { name: "1.2K", exact: true }).waitFor();
  await row.getByRole("cell", { name: "1×", exact: true }).waitFor();

  await observe(sighting("2026-10-22T07:00:00.000Z", 25000, 400));
  await page.getByRole("button", { name: "Refresh" }).click();
  await row.getByRole("cell", { name: "25K", exact: true }).waitFor();
  await row.getByRole("cell", { name: "400", exact: true }).waitFor();
  await row.getByRole("cell", { name: "2×", exact: true }).waitFor();
  // A second sighting updates the post; it never lists it twice.
  expect(await row.count()).toBe(1);

  const { posts } = await rpc("observations.listRecent", {});
  expect(posts).toMatchObject([{ observations: 2, metrics: { views: 25000, likes: 400 } }]);
  // Observations are read off X's own traffic: nothing is fetched or paid for.
  expect(treg.calls).toEqual([]);
});
