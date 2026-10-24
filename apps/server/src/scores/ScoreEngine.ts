import type {
  BotReport,
  CategoryCount,
  FollowerCategory,
  ScoreDiff,
  Tier,
  TopFollower,
  XFollower,
} from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

import seed from "./seed.json" with { type: "json" };

const DAY_MS = 86_400_000;
/** The score sums the K biggest followers by reach, so runs of different sample sizes compare. */
export const SCORE_TOP_K = 100;

const SEEDED = new Map<string, FollowerCategory>(
  (["kol", "project", "fund"] as const).flatMap((c) => seed[c].map((h) => [h, c] as const)),
);
const FUND = /\b(vc|capital|fund|ventures|partners|investors?|investing|investments)\b/i;
const PROJECT =
  /\b(protocol|labs|official|app|dao|network|chain|foundation|exchange|wallet)\b|\.(io|xyz|fi)\b/i;

/** Curated seed first, then words in the name and bio, then reach for the people who are left. */
export const categoryOf = (f: XFollower): FollowerCategory => {
  const seeded = SEEDED.get(f.handle);
  if (seeded !== undefined) return seeded;
  const text = `${f.name} ${f.bio}`;
  if (FUND.test(text)) return "fund";
  if (PROJECT.test(text) || PROJECT.test(f.handle)) return "project";
  return f.followers > 50_000 ? "kol" : "person";
};

const ageMs = (f: XFollower, now: DateTime.DateTime) =>
  f.createdAt === null
    ? null
    : DateTime.toEpochMillis(now) - DateTime.toEpochMillis(DateTime.makeUnsafe(f.createdAt));

/**
 * Sorsa-style points: who follows you, not how many. Reach counts on a log
 * scale, verified doubles it, follow-for-follow accounts count a quarter and
 * accounts under a year old count less until they have been around.
 */
export const pointsFor = (f: XFollower, now: DateTime.DateTime): number => {
  const age = ageMs(f, now);
  return (
    Math.log10(Math.max(f.followers, 10)) *
    (f.verified ? 2 : 1) *
    (f.following > 0 && f.followers / f.following < 0.2 ? 0.25 : 1) *
    (age === null || age >= 365 * DAY_MS ? 1 : age >= 180 * DAY_MS ? 0.75 : 0.5)
  );
};

// Calibrated for K = 100: an average top follower at 1k reach is 3 points, at 100k verified 10.
export const tierFor = (score: number): Tier =>
  score >= 900
    ? "Supreme"
    : score >= 600
      ? "Significant"
      : score >= 400
        ? "Credible"
        : score >= 200
          ? "Noted"
          : "Unknown";

/** Tiny accounts following everyone, or blank accounts younger than 90 days. */
const isSuspicious = (f: XFollower, now: DateTime.DateTime): boolean => {
  const age = ageMs(f, now);
  return (
    (f.followers < 50 && f.following > 10 * f.followers) ||
    (f.bio === "" && age !== null && age < 90 * DAY_MS)
  );
};

export interface ScoreResult {
  readonly score: number;
  readonly tier: Tier;
  /** The whole scored top K, by points. */
  readonly scored: ReadonlyArray<TopFollower>;
  readonly categories: ReadonlyArray<CategoryCount>;
  readonly bot: BotReport;
}

export const score = (
  followers: ReadonlyArray<XFollower>,
  account: { readonly followers: number; readonly following: number },
  now: DateTime.DateTime,
): ScoreResult => {
  const scored = [...followers]
    .sort((a, b) => b.followers - a.followers)
    .slice(0, SCORE_TOP_K)
    .map((f): TopFollower =>
      Object.assign({ points: pointsFor(f, now), category: categoryOf(f) }, f),
    )
    .sort((a, b) => b.points - a.points);
  const total = Math.round(scored.reduce((sum, f) => sum + f.points, 0) * 10) / 10;
  const suspicious = followers.filter((f) => isSuspicious(f, now));
  return {
    score: total,
    // From the shown score, so 199.96 reads as 200 and Noted, not 200 and Unknown.
    tier: tierFor(total),
    scored,
    categories: (["kol", "project", "fund", "person"] as const).map((category) => {
      const of = scored.filter((f) => f.category === category);
      return { category, count: of.length, points: of.reduce((s, f) => s + f.points, 0) };
    }),
    bot: {
      botShare: followers.length === 0 ? 0 : suspicious.length / followers.length,
      followRatio: account.following === 0 ? null : account.followers / account.following,
      suspicious: [...suspicious].sort((a, b) => b.following - a.following).slice(0, 10),
    },
  };
};

/** Who moved the score between two scored sets: joined, left, or worth a different number of points. */
export const diff = (
  previous: ReadonlyArray<TopFollower>,
  current: ReadonlyArray<TopFollower>,
  sinceAt: string,
): ScoreDiff => {
  const before = new Map(previous.map((f) => [f.userId, f]));
  const after = new Map(current.map((f) => [f.userId, f]));
  const changed = current.flatMap((f) => {
    const p = before.get(f.userId);
    return p === undefined || Math.abs(p.points - f.points) < 0.05
      ? []
      : [{ ...f, previousPoints: p.points }];
  });
  return {
    sinceAt,
    joined: current.filter((f) => !before.has(f.userId)),
    left: previous.filter((f) => !after.has(f.userId)),
    changed: changed.sort(
      (a, b) => Math.abs(b.points - b.previousPoints) - Math.abs(a.points - a.previousPoints),
    ),
  };
};
