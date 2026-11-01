import type { EngineUser } from "@xtend/contracts";

/** The @handle being typed at the caret: where its @ sits and what follows it; null outside one. */
export const mentionAt = (text: string, caret: number) => {
  const typed = /(?:^|[^\w@])@(\w{0,15})$/.exec(text.slice(0, caret))?.[1];
  return typed === undefined ? null : { start: caret - typed.length - 1, query: typed };
};

/**
 * People the engine already saw whose handle, or a word of whose name, starts with `query`:
 * handle matches first, then the people the user follows, then the bigger account. Never the
 * user themself (`self`, a handle). Nothing is fetched for it.
 */
export function mentionMatches(
  users: Iterable<EngineUser>,
  query: string,
  follows: (user: EngineUser) => boolean,
  self: string | null,
  limit = 6,
) {
  const q = query.toLowerCase();
  const rank = (u: EngineUser) =>
    u.handle.toLowerCase().startsWith(q)
      ? 0
      : u.name
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(q))
        ? 1
        : null;
  const found: Array<{ user: EngineUser; rank: number; follows: boolean }> = [];
  for (const user of users) {
    const r = rank(user);
    if (r !== null && user.handle.toLowerCase() !== self?.toLowerCase())
      found.push({ user, rank: r, follows: follows(user) });
  }
  return found
    .toSorted(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.follows) - Number(a.follows) ||
        (b.user.followers ?? 0) - (a.user.followers ?? 0),
    )
    .slice(0, limit)
    .map((f) => f.user);
}
