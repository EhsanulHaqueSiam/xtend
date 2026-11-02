import type { Candidate, ObservedPostSummary, XPost } from "@xtend/contracts";

/** An observed post in the shape the tools take, with what the session never sees left null. */
export const observedToXPost = (o: ObservedPostSummary): XPost => ({
  ...o,
  url: `https://x.com/${o.author.handle}/status/${o.postId}`,
  lang: null,
  author: { ...o.author, avatarUrl: null },
});

type Test = (p: ObservedPostSummary, text: string) => boolean;
const COUNTS = { min_faves: "likes", min_retweets: "reposts", min_replies: "replies" } as const;

/** One term of X's query as a test, and whether it names what to find rather than only narrowing. */
const term = (raw: string): { readonly test: Test; readonly finds: boolean } | null => {
  const t = raw.replace(/^\(|\)$/g, "");
  if (t.startsWith("-") && t.length > 1) {
    const not = term(t.slice(1));
    return not === null ? null : { test: (p, text) => !not.test(p, text), finds: false };
  }
  const from = /^from:(\w+)$/i.exec(t);
  if (from !== null) {
    const handle = from[1]!.toLowerCase();
    return { test: (p) => p.author.handle.toLowerCase() === handle, finds: true };
  }
  const count = /^(min_faves|min_retweets|min_replies):(\d+)$/i.exec(t);
  if (count !== null) {
    const field = COUNTS[count[1]!.toLowerCase() as keyof typeof COUNTS];
    return { test: (p) => p.metrics[field] >= Number(count[2]), finds: false };
  }
  const date = /^(since|until):(\d{4}-\d{2}-\d{2})$/i.exec(t);
  if (date !== null)
    return {
      test: (p) =>
        date[1]!.toLowerCase() === "since" ? p.createdAt >= date[2]! : p.createdAt < date[2]!,
      finds: false,
    };
  const filter = /^filter:(replies|links|media)$/i.exec(t)?.[1]?.toLowerCase();
  if (filter !== undefined) {
    const key = filter === "replies" ? "isReply" : filter === "links" ? "hasLink" : "hasMedia";
    return { test: (p) => p[key], finds: false };
  }
  // Any other operator is X's alone to apply; the seen copy cannot answer it, so it narrows nothing.
  if (/^\w+:/.test(t)) return null;
  const needle = t.replace(/^"|"$/g, "").toLowerCase();
  return needle === "" ? null : { test: (_, text) => text.includes(needle), finds: true };
};

/**
 * Observed posts matching an X search query: words and "phrases" in the text, `a OR b`,
 * `-word`, `from:`, min_faves/min_retweets/min_replies, since/until and filter:replies|links|media.
 * Other operators are skipped. A query that names nothing to find matches nothing.
 */
export const observedMatching = (posts: ReadonlyArray<ObservedPostSummary>, query: string) => {
  // Each clause is a run of terms joined by OR; a post must pass every clause.
  const clauses: Array<Array<NonNullable<ReturnType<typeof term>>>> = [];
  let joinNext = false;
  for (const raw of query.match(/-?"[^"]*"|\S+/g) ?? []) {
    if (raw === "OR") {
      joinNext = clauses.length > 0;
      continue;
    }
    const read = term(raw);
    if (read === null) continue;
    if (joinNext) clauses.at(-1)!.push(read);
    else clauses.push([read]);
    joinNext = false;
  }
  if (!clauses.some((c) => c.some((t) => t.finds))) return [];
  return posts.filter((p) => {
    const text = p.text.toLowerCase();
    return clauses.every((c) => c.some((t) => t.test(p, text)));
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

/** Authors of seen posts matching an X search, once each, at or above `minFollowers`: a free list preview. */
export const observedAuthors = (
  posts: ReadonlyArray<ObservedPostSummary>,
  query: string,
  minFollowers = 0,
): Array<Candidate> => {
  const byHandle = new Map<string, Candidate>();
  for (const { author: a } of observedMatching(posts, query)) {
    const key = a.handle.toLowerCase();
    if (byHandle.has(key) || (a.followers ?? 0) < minFollowers) continue;
    byHandle.set(key, {
      handle: a.handle,
      name: a.name,
      userId: a.userId,
      followers: a.followers,
      bio: "",
    });
  }
  return [...byHandle.values()];
};
