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
