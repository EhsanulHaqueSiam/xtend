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
    expect(ScoreEngine.pointsFor(follower({ followers: 1000 }), now)).toBe(3);
    expect(ScoreEngine.pointsFor(follower({ followers: 1000, verified: true }), now)).toBe(6);
    expect(ScoreEngine.pointsFor(follower({ followers: 100, following: 1000 }), now)).toBe(0.5);
    expect(ScoreEngine.pointsFor(follower({ followers: 0, following: 0 }), now)).toBe(1);
  });

  it("discounts accounts younger than a year", () => {
    expect(ScoreEngine.pointsFor(follower({ createdAt: "2026-08-01T00:00:00.000Z" }), now)).toBe(
      1.5,
    );
    expect(ScoreEngine.pointsFor(follower({ createdAt: "2026-03-01T00:00:00.000Z" }), now)).toBe(
      2.25,
    );
  });

  it("categorises by seed list, then bio words, then reach", () => {
    expect(ScoreEngine.categoryOf(follower({ handle: "paradigm", bio: "" }))).toBe("fund");
    expect(ScoreEngine.categoryOf(follower({ bio: "GP at Acme Ventures" }))).toBe("fund");
    expect(ScoreEngine.categoryOf(follower({ name: "Acme Protocol" }))).toBe("project");
    expect(ScoreEngine.categoryOf(follower({ bio: "building acme.io" }))).toBe("project");
    expect(ScoreEngine.categoryOf(follower({ followers: 80_000 }))).toBe("kol");
    expect(ScoreEngine.categoryOf(follower({}))).toBe("person");
    const result = ScoreEngine.score(
      [follower({ userId: "1", followers: 80_000 }), follower({ userId: "2" })],
      { followers: 1, following: 1 },
      now,
    );
    expect(result.categories.map((c) => [c.category, c.count])).toEqual([
      ["kol", 1],
      ["project", 0],
      ["fund", 0],
      ["person", 1],
    ]);
  });

  it("diffs two scored sets into joined, left and changed", () => {
    const scored = (patch: Partial<XFollower>, points: number) => ({
      ...follower(patch),
      points,
      category: "person" as const,
    });
    const d = ScoreEngine.diff(
      [scored({ userId: "a" }, 3), scored({ userId: "b" }, 3), scored({ userId: "c" }, 3)],
      [scored({ userId: "a" }, 3), scored({ userId: "b" }, 6), scored({ userId: "d" }, 2)],
      "2026-10-20T00:00:00.000Z",
    );
    expect(d.joined.map((f) => f.userId)).toEqual(["d"]);
    expect(d.left.map((f) => f.userId)).toEqual(["c"]);
    expect(d.changed.map((f) => [f.userId, f.previousPoints, f.points])).toEqual([["b", 3, 6]]);
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
    const small = Array.from({ length: 300 }, (_, i) =>
      follower({ userId: `s${i}`, followers: 10 }),
    );
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
    expect(result.scored[0]?.userId).toBe("4");
    expect(result.tier).toBe("Unknown");
  });
});
