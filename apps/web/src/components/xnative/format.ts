import type { EnginePost } from "@xtend/contracts";

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const FULL_DATE = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const CLOCK = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

/** A post's age the way X writes it in a list: 28m, 16h, then Oct 30, then Oct 30, 2025. */
export const xAge = (iso: string, now = Date.now()) => {
  const at = new Date(iso);
  const s = Math.max(0, (now - at.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return at.getFullYear() === new Date(now).getFullYear()
    ? MONTH_DAY.format(at)
    : FULL_DATE.format(at);
};

/** The focal post's timestamp line, as X prints it under the post: 2:41 PM · Oct 31, 2026. */
export const xStamp = (iso: string) => {
  const at = new Date(iso);
  return `${CLOCK.format(at)} · ${FULL_DATE.format(at)}`;
};

/** Likes, reposts, replies, quotes and bookmarks over views; null until X reports views. */
export const engagement = (p: EnginePost) => {
  const m = p.metrics;
  if (m.views === null || m.views === 0) return null;
  return (m.likes + m.reposts + m.replies + m.quotes + m.bookmarks) / m.views;
};

/** Views per hour since posting, counted from the first full minute. */
export const viewsPerHour = (p: EnginePost, now = Date.now()) => {
  const hours = (now - new Date(p.createdAt).getTime()) / 3_600_000;
  return p.metrics.views === null || hours < 1 / 60 ? null : p.metrics.views / hours;
};

/**
 * This post's views against the median of the author's other posts the engine has seen; null
 * with fewer than three to compare, where a ratio would mislead.
 */
export const vsAuthor = (p: EnginePost, seen: Iterable<EnginePost>) => {
  if (p.metrics.views === null) return null;
  const others = [...seen]
    .filter((o) => o.author.userId === p.author.userId && o.postId !== p.postId)
    .flatMap((o) => (o.metrics.views === null ? [] : [o.metrics.views]))
    .toSorted((a, b) => a - b);
  if (others.length < 3) return null;
  const median = others[Math.floor(others.length / 2)]!;
  return median === 0 ? null : p.metrics.views / median;
};

/** X serves a 48px avatar by default; a 40px circle on a 2x screen wants the 96px one. */
export const avatar96 = (url: string) => url.replace(/_normal(\.\w+)$/, "_x96$1");
