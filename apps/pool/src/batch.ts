/**
 * The shape of one push, checked here so a bad body is refused before it reaches
 * Postgres. The database checks each item again; this stops the obvious.
 */
const MAX_ITEMS = 500;
export const MAX_BODY_BYTES = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isInstallId = (value: string | null): value is string =>
  value !== null && UUID.test(value);

/** The items of a push body, or the reason it is refused. */
export function readBatch(body: unknown): { items: unknown[] } | { error: string } {
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
  return { items };
}
