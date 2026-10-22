import type { BotReport, Tier, TopFollower, XFollower } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

const DAY_MS = 86_400_000;
/** The score sums the K biggest followers by reach, so runs of different sample sizes compare. */
export const SCORE_TOP_K = 100;

/**
 * Sorsa-style points: who follows you, not how many. Reach counts on a log
 * scale, verified doubles it, follow-for-follow accounts count a quarter.
 */
export const pointsFor = (f: XFollower): number =>
  Math.log10(Math.max(f.followers, 10)) *
  (f.verified ? 2 : 1) *
  (f.following > 0 && f.followers / f.following < 0.2 ? 0.25 : 1);

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
const isSuspicious = (f: XFollower, now: DateTime.DateTime): boolean =>
  (f.followers < 50 && f.following > 10 * f.followers) ||
  (f.bio === "" &&
    f.createdAt !== null &&
    DateTime.toEpochMillis(now) - DateTime.toEpochMillis(DateTime.makeUnsafe(f.createdAt)) <
      90 * DAY_MS);

export interface ScoreResult {
  readonly score: number;
  readonly tier: Tier;
  readonly topFollowers: ReadonlyArray<TopFollower>;
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
    .map((f) => Object.assign({ points: pointsFor(f) }, f));
  const total = scored.reduce((sum, f) => sum + f.points, 0);
  const suspicious = followers.filter((f) => isSuspicious(f, now));
  return {
    score: Math.round(total * 10) / 10,
    tier: tierFor(total),
    topFollowers: [...scored].sort((a, b) => b.points - a.points).slice(0, 20),
    bot: {
      botShare: followers.length === 0 ? 0 : suspicious.length / followers.length,
      followRatio: account.following === 0 ? null : account.followers / account.following,
      suspicious: [...suspicious].sort((a, b) => b.following - a.following).slice(0, 10),
    },
  };
};
