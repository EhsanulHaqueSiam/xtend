import type { ObservedPostSummary, XPost } from "@xtend/contracts";

/** An observed post in the XPost shape the Engage lists render. */
export const observedToPost = (p: ObservedPostSummary): XPost => ({
  postId: p.postId,
  url: `https://x.com/${p.author.handle}/status/${p.postId}`,
  text: p.text,
  createdAt: p.createdAt,
  lang: null,
  isReply: p.isReply,
  isRepost: false,
  hasMedia: p.hasMedia,
  hasLink: p.hasLink,
  author: { ...p.author, avatarUrl: null },
  metrics: p.metrics,
});

/** True when the text tags @handle itself, not a longer handle that starts with it (@siam in @siamships). */
export const tagsHandle = (text: string, handle: string): boolean =>
  new RegExp(`@${handle}(?![A-Za-z0-9_])`, "i").test(text);

/**
 * Replies and quotes aimed at the user among what the session saw. The capture
 * has no in-reply-to id, so a reply counts when it addresses @handle and a
 * quote when it links one of the user's posts.
 */
export const matchIncoming = (
  posts: ReadonlyArray<ObservedPostSummary>,
  handle: string,
): ReadonlyArray<XPost> => {
  const me = handle.toLowerCase();
  const quote = `x.com/${me}/status/`;
  return posts
    .filter((p) => {
      if (p.author.handle.toLowerCase() === me) return false;
      return (p.isReply && tagsHandle(p.text, me)) || p.text.toLowerCase().includes(quote);
    })
    .map(observedToPost);
};
