import type { ObservedPostSummary } from "@xtend/contracts";

/** Handles a reply opens with, lowercased: "@a @b text" gives a and b. */
export const leadingHandles = (text: string) =>
  (text.match(/^(?:@\w+\s*)+/)?.[0] ?? "")
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((t) => t.slice(1).toLowerCase());

/** The user's own posts (or replies) that did best, as examples of their taste for the model. */
export const bestOwn = (
  posts: ReadonlyArray<ObservedPostSummary>,
  kind: "posts" | "replies",
  limit = 5,
): ReadonlyArray<string> =>
  posts
    .filter((p) => p.isReply === (kind === "replies"))
    .map((p) => ({
      text: p.text,
      score: p.metrics.likes + 2 * p.metrics.reposts + p.metrics.replies + p.metrics.bookmarks,
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((p) => p.text);
