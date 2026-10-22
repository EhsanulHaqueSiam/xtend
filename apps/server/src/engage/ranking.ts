import type { XPost } from "@xtend/contracts";

/**
 * Expected reach of a reply on this post: views per hour since it was posted,
 * lifted by reply velocity (a busy thread keeps surfacing) and author size.
 */
export const rankTarget = (post: XPost, nowMs: number) => {
  const ageMinutes = Math.max(1, (nowMs - Date.parse(post.createdAt)) / 60_000);
  const viewsPerHour = ((post.metrics.views ?? 0) / ageMinutes) * 60;
  const followers = post.author.followers ?? 0;
  const score = viewsPerHour * (1 + post.metrics.replies / 50) * Math.log10(10 + followers);
  return { ageMinutes, viewsPerHour, score };
};
