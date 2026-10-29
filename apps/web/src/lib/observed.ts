import type { ObservedPostSummary, XPost } from "@xtend/contracts";

/** An observed post in the shape the tools take, with what the session never sees left null. */
export const observedToXPost = (o: ObservedPostSummary): XPost => ({
  ...o,
  url: `https://x.com/${o.author.handle}/status/${o.postId}`,
  lang: null,
  author: { ...o.author, avatarUrl: null },
});

/** Observed posts whose text holds every word of a query; X's operators are ignored. */
export const observedMatching = (posts: ReadonlyArray<ObservedPostSummary>, query: string) => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "" && !w.includes(":") && !w.startsWith("-"));
  if (words.length === 0) return [];
  return posts.filter((p) => {
    const text = p.text.toLowerCase();
    return words.every((w) => text.includes(w));
  });
};

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9']{3,}/g) ?? []);

/**
 * Seen posts that share at least two longer words with `text`, most shared first: a free
 * "similar posts" from what the session already scrolled past, before any paid search.
 */
export const observedSimilar = (
  posts: ReadonlyArray<ObservedPostSummary>,
  text: string,
  limit = 3,
) => {
  const mine = words(text);
  return posts
    .filter((p) => !p.isRepost && !p.isPromoted)
    .map((p) => ({ post: p, shared: [...words(p.text)].filter((w) => mine.has(w)).length }))
    .filter((s) => s.shared >= 2)
    .sort((a, b) => b.shared - a.shared || b.post.metrics.likes - a.post.metrics.likes)
    .slice(0, limit)
    .map((s) => s.post);
};
