import type { AccountPost, AnalyzeData, PostKind } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { DESKTOP, endlessAnimations, SAMPLES, settled, timeMount } from "../../../test/bench";
import type { FakeService } from "../../../test/fakeService";
import { quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Posts } from "./PostsTable";

const KINDS: ReadonlyArray<PostKind> = ["text", "media", "link", "reply", "thread"];
const START = Date.parse("2026-10-28T12:00:00.000Z");

/** 200 own posts, one every 12 hours, with the private metrics the nightly job adds for each. */
const posts = Array.from({ length: 200 }, (_, i): AccountPost => ({
  postId: String(1_980_000_000_000_000_000n + BigInt(i)),
  url: `https://x.com/siamships/status/${1_980_000_000_000_000_000n + BigInt(i)}`,
  text: `Post ${i}: what shipping a feature every day for a month taught me about distribution`,
  createdAt: new Date(START - i * 43_200_000).toISOString(),
  kind: KINDS[i % KINDS.length]!,
  views: 1_000 + ((i * 7_919) % 40_000),
  likes: (i * 31) % 400,
  reposts: i % 17,
  replies: i % 23,
  quotes: i % 5,
  bookmarks: i % 11,
}));

const data = (rows: ReadonlyArray<AccountPost>): AnalyzeData => ({
  handle: "siamships",
  avatarUrl: null,
  fetchedAt: "2026-10-28T12:00:00.000Z",
  posts: rows,
  snapshots: [],
  heatmap: [],
  timeZone: "UTC",
  windows: [],
  viewsByPostDay: [],
  followerDelta30d: null,
  nonPublic: {
    lastRun: { at: "2026-10-28T03:00:00.000Z", posts: rows.length, error: null },
    byPost: rows.map((p, i) => ({
      postId: p.postId,
      day: "2026-10-28",
      impressions: (p.views ?? 0) * 2,
      profileVisits: i % 40,
      linkClicks: i % 9,
      follows: i % 7,
      likes: p.likes,
      replies: p.replies,
      reposts: p.reposts,
    })),
  },
});

// The posts table comes first; "Posts that gained followers" is a second table under it.
const rows = (root: HTMLElement) => root.querySelector("table")?.tBodies[0]?.rows;

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("Analyze Posts with 200 posts", async ({ bench }) => {
  // The page's refresh button mounts the data atom, as the route does.
  const service: FakeService = {
    "costs.quote": quoting(),
    "analyze.data": () => Effect.succeed(data(posts)),
  };
  const all = (root: HTMLElement) => rows(root)?.length === posts.length;

  const mount = await bench(
    "Analyze Posts: mount 200",
    timeMount(<Posts data={data(posts)} />, { service }, all),
  ).run(SAMPLES);
  expect(mount.latency.p50).toBeLessThan(200); // 19ms

  await using screen = await render(<Posts data={data(posts)} />, { service });
  await settled(screen.container, () => all(screen.container));
  expect(endlessAnimations()).toEqual([]);

  // A refresh brings new numbers for one post; the screen gets the whole data again.
  let version = 0;
  const update = await bench("Analyze Posts: one row changes", async () => {
    version += 1;
    const text = `Post 0, edited ${version}`;
    await screen.rerender(<Posts data={data(posts.with(0, { ...posts[0]!, text }))} />);
    await settled(
      screen.container,
      () => rows(screen.container)?.[0]?.textContent.includes(text) === true,
    );
  }).run(SAMPLES);
  expect(update.latency.p50).toBeLessThan(80); // 8ms
});
