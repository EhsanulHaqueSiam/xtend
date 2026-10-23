import type { XPost } from "@xtend/contracts";

import type { ReplyTarget } from "@xtend/contracts";

/** Views-per-hour band a reply would sit under; the UI shows this, not the ranking number. */
const reachBand = (viewsPerHour: number): ReplyTarget["reach"] =>
  viewsPerHour >= 10_000
    ? "10k+/h"
    : viewsPerHour >= 1_000
      ? "1k to 10k/h"
      : viewsPerHour >= 100
        ? "100 to 1k/h"
        : "under 100/h";

/**
 * Ranking for reply targets: views per hour since it was posted, lifted by
 * author size (and by the author's Scores sample when one exists; the scale
 * tops out near 1000) and damped by replies already there (a crowded thread
 * buries a new reply). Not a reach estimate; `reach` is.
 */
export const rankTarget = (post: XPost, nowMs: number, authorScore: number | null = null) => {
  const ageMinutes = Math.max(1, (nowMs - Date.parse(post.createdAt)) / 60_000);
  const viewsPerHour = ((post.metrics.views ?? 0) / ageMinutes) * 60;
  const followers = post.author.followers ?? 0;
  const lift = Math.log10(10 + followers) * (authorScore === null ? 1 : 1 + authorScore / 1000);
  const score = (viewsPerHour * lift) / (1 + post.metrics.replies / 50);
  return { ageMinutes, viewsPerHour, score, reach: reachBand(viewsPerHour) };
};
