/**
 * The shape of one push, checked here so a bad body is refused before it is queued.
 * The database checks each item again; this stops the obvious.
 */
const MAX_ITEMS = 500;
export const MAX_BODY_BYTES = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INT4 = 2_147_483_647;

export const isInstallId = (value: string | null): value is string =>
  value !== null && UUID.test(value);

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
// Postgres refuses NUL and lone surrogates in jsonb.
const text = (value: unknown) =>
  typeof value === "string" ? value.toWellFormed().replaceAll("\0", "") : undefined;
const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const int = (value: unknown, max: number) =>
  Number.isInteger(value) && Math.abs(value as number) <= max ? (value as number) : undefined;
const time = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return ms >= 0 && ms < Date.UTC(2100, 0) ? new Date(ms).toISOString() : undefined;
};

/**
 * Rebuilds an item from only the fields pool_push reads, each in a form its casts accept, so
 * one crafted push cannot fail a whole flush chunk. A field that does not fit is left out and
 * pool_push then skips the item or stores null, as it would for a missing one.
 */
const clean = (item: unknown) => {
  const post = record(record(item).post);
  const author = record(post.author);
  const m = record(record(item).metrics);
  return {
    post: {
      postId: text(post.postId),
      text: text(post.text),
      lang: text(post.lang),
      createdAt: time(post.createdAt),
      isReply: flag(post.isReply),
      hasMedia: flag(post.hasMedia),
      hasLink: flag(post.hasLink),
      author: {
        userId: text(author.userId),
        handle: text(author.handle),
        name: text(author.name),
        followers: int(author.followers, INT4),
        verified: flag(author.verified),
      },
    },
    metrics: {
      views: int(m.views, Number.MAX_SAFE_INTEGER),
      likes: int(m.likes, INT4),
      reposts: int(m.reposts, INT4),
      replies: int(m.replies, INT4),
      quotes: int(m.quotes, INT4),
      bookmarks: int(m.bookmarks, INT4),
    },
  };
};

/** The cleaned items of a push body, or the reason it is refused. */
export function readBatch(
  body: unknown,
): { items: ReturnType<typeof clean>[] } | { error: string } {
  if (typeof body !== "object" || body === null || !("items" in body))
    return { error: "body must be { items: [...] }" };
  const items = (body as { items: unknown }).items;
  if (!Array.isArray(items)) return { error: "items must be an array" };
  if (items.length === 0) return { error: "items is empty" };
  if (items.length > MAX_ITEMS) return { error: `at most ${MAX_ITEMS} items` };
  for (const item of items) {
    if (typeof item !== "object" || item === null) return { error: "item must be an object" };
    const post = (item as { post?: unknown }).post;
    if (typeof post !== "object" || post === null) return { error: "item.post is missing" };
    if (typeof (post as { postId?: unknown }).postId !== "string")
      return { error: "item.post.postId must be a string" };
  }
  // Without these pool_push would reach a not-null column instead of skipping the item.
  const usable = items
    .map(clean)
    .filter((i) => i.post.createdAt && i.post.author.userId && i.post.author.handle);
  if (usable.length === 0) return { error: "no item has a post time, author id and handle" };
  return { items: usable };
}
