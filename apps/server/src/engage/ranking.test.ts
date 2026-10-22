import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

import { rankTarget } from "./ranking.ts";

const now = Date.parse("2026-10-22T12:00:00.000Z");
const post = (minutesAgo: number, views: number, replies: number, followers: number): XPost => ({
  postId: "1",
  url: "https://x.com/a/status/1",
  text: "t",
  createdAt: DateTime.formatIso(DateTime.makeUnsafe(now - minutesAgo * 60_000)),
  lang: null,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: "1", handle: "a", name: "A", followers, verified: false, avatarUrl: null },
  metrics: { views, likes: 0, reposts: 0, replies, quotes: 0, bookmarks: 0 },
});

describe("rankTarget", () => {
  it("prefers a fresh fast post over an old big one", () => {
    const fresh = rankTarget(post(30, 3000, 0, 1000), now);
    const old = rankTarget(post(24 * 60, 20_000, 0, 1000), now);
    expect(fresh.viewsPerHour).toBe(6000);
    expect(fresh.score).toBeGreaterThan(old.score);
  });

  it("lifts the score with replies and followers", () => {
    const quiet = rankTarget(post(60, 1000, 0, 0), now);
    const busy = rankTarget(post(60, 1000, 50, 0), now);
    const big = rankTarget(post(60, 1000, 0, 99_990), now);
    expect(busy.score).toBeCloseTo(quiet.score * 2);
    expect(big.score).toBeCloseTo(quiet.score * 5);
  });

  it("never divides by a zero age and tolerates null views", () => {
    const r = rankTarget(
      { ...post(0, 0, 0, 0), metrics: { ...post(0, 0, 0, 0).metrics, views: null } },
      now,
    );
    expect(r.ageMinutes).toBe(1);
    expect(r.score).toBe(0);
  });
});
