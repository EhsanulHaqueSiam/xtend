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
 * author size and damped by replies already there (a crowded thread buries
 * a new reply). Not a reach estimate; `reach` is.
 */
export const rankTarget = (post: XPost, nowMs: number) => {
  const ageMinutes = Math.max(1, (nowMs - Date.parse(post.createdAt)) / 60_000);
  const viewsPerHour = ((post.metrics.views ?? 0) / ageMinutes) * 60;
  const followers = post.author.followers ?? 0;
  const score = (viewsPerHour * Math.log10(10 + followers)) / (1 + post.metrics.replies / 50);
  return { ageMinutes, viewsPerHour, score, reach: reachBand(viewsPerHour) };
};
