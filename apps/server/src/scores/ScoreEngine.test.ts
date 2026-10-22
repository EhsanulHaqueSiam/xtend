import { describe, expect, it } from "@effect/vitest";
import type { XFollower } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

import * as ScoreEngine from "./ScoreEngine.ts";

const now = DateTime.makeUnsafe("2026-10-22T00:00:00.000Z");

const follower = (patch: Partial<XFollower>): XFollower => ({
  userId: "1",
  handle: "a",
  name: "A",
  followers: 1000,
  following: 500,
  verified: false,
  bio: "builds things",
  createdAt: "2020-01-01T00:00:00.000Z",
  ...patch,
});

describe("ScoreEngine", () => {
  it("scores reach on a log scale, doubles verified, quarters follow-for-follow", () => {
    expect(ScoreEngine.pointsFor(follower({ followers: 1000 }))).toBe(3);
    expect(ScoreEngine.pointsFor(follower({ followers: 1000, verified: true }))).toBe(6);
    expect(ScoreEngine.pointsFor(follower({ followers: 100, following: 1000 }))).toBe(0.5);
    expect(ScoreEngine.pointsFor(follower({ followers: 0, following: 0 }))).toBe(1);
  });

  it("maps totals to tiers", () => {
    expect(ScoreEngine.tierFor(199)).toBe("Unknown");
    expect(ScoreEngine.tierFor(200)).toBe("Noted");
    expect(ScoreEngine.tierFor(400)).toBe("Credible");
    expect(ScoreEngine.tierFor(600)).toBe("Significant");
    expect(ScoreEngine.tierFor(900)).toBe("Supreme");
  });

  it("scores the top K by reach, so a bigger sample does not inflate it", () => {
    const big = Array.from({ length: ScoreEngine.SCORE_TOP_K }, (_, i) =>
      follower({ userId: `b${i}`, followers: 10_000 }),
    );
    const small = Array.from({ length: 300 }, (_, i) => follower({ userId: `s${i}`, followers: 10 }));
    const base = ScoreEngine.score(big, { followers: 1, following: 1 }, now);
    const padded = ScoreEngine.score([...small, ...big], { followers: 1, following: 1 }, now);
    expect(padded.score).toBe(base.score);
    expect(base.score).toBe(400);
  });

  it("flags bots and reports their share", () => {
    const followers = [
      follower({ userId: "1", followers: 5, following: 2000 }),
      follower({ userId: "2", bio: "", createdAt: "2026-10-01T00:00:00.000Z" }),
      follower({ userId: "3", bio: "", createdAt: "2024-01-01T00:00:00.000Z" }),
      follower({ userId: "4", followers: 50_000, verified: true }),
    ];
    const result = ScoreEngine.score(followers, { followers: 200, following: 100 }, now);
    expect(result.bot.botShare).toBe(0.5);
    expect(result.bot.followRatio).toBe(2);
    expect(result.bot.suspicious.map((f) => f.userId)).toEqual(["1", "2"]);
    expect(result.topFollowers[0]?.userId).toBe("4");
    expect(result.tier).toBe("Unknown");
  });
});
