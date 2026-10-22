import { describe, expect, it } from "@effect/vitest";
import type { AccountPost } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

import { summarize } from "./Analytics.ts";

const now = Date.parse("2026-10-22T12:00:00.000Z");
const DAY = 86_400_000;
const post = (daysAgo: number, views: number, likes: number): AccountPost => ({
  postId: String(daysAgo),
  url: "u",
  text: "t",
  createdAt: DateTime.formatIso(DateTime.makeUnsafe(now - daysAgo * DAY)),
  kind: "text",
  views,
  likes,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
});

describe("Analytics.summarize", () => {
  it("weights engagement rate by views and groups views by the day posted", () => {
    const posts = [post(1, 10_000, 100), post(2, 100, 50), post(40, 1_000_000, 0)];
    const s = summarize(posts, [], now);
    const week = s.windows.find((w) => w.days === 7)!;
    expect(week.posts).toBe(2);
    // 150 engagements over 10,100 views, not the mean of 1% and 50%.
    expect(week.engagementRate).toBeCloseTo(150 / 10_100);
    expect(s.viewsByPostDay.map((d) => d.views)).toEqual([100, 10_000]);
  });

  it("measures follower change against the snapshot at least 30 days old", () => {
    const snapshots = [
      { day: "2026-08-01", followers: 100, following: 1, posts: 1 },
      { day: "2026-09-20", followers: 150, following: 1, posts: 1 },
      { day: "2026-10-21", followers: 170, following: 1, posts: 1 },
      { day: "2026-10-22", followers: 180, following: 1, posts: 1 },
    ];
    expect(summarize([], snapshots, now).followerDelta30d).toEqual({
      delta: 30,
      sinceDay: "2026-09-20",
    });
    expect(summarize([], snapshots.slice(2), now).followerDelta30d).toBeNull();
  });
});
