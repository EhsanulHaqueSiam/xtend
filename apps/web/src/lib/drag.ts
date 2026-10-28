/**
 * What a drag carries. X renders every post as a link, so a post dragged out of
 * the session view, a browser tab or a saved card arrives as a URL; the only
 * fact read from it is which post and who wrote it.
 */
export interface DraggedPost {
  readonly postId: string;
  readonly handle: string;
  readonly url: string;
}

const STATUS =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

/** The post a status URL names, or null for any other text. */
export const postFromUrl = (text: string): DraggedPost | null => {
  const m = STATUS.exec(text.trim());
  return m === null
    ? null
    : { handle: m[1]!, postId: m[2]!, url: `https://x.com/${m[1]}/status/${m[2]}` };
};

/** The first status URL in a drop; links arrive as `text/uri-list`, selections as `text/plain`. */
export const postFromTransfer = (dt: DataTransfer): DraggedPost | null => {
  for (const type of ["text/uri-list", "text/plain"]) {
    for (const line of dt.getData(type).split(/\r?\n/)) {
      if (line.startsWith("#")) continue;
      const post = postFromUrl(line);
      if (post !== null) return post;
    }
  }
  return null;
};

/** True while a link or text drag is over the window; the data itself is only readable on drop. */
export const carriesLink = (dt: DataTransfer | null) =>
  dt !== null && Array.from(dt.types).some((t) => t === "text/uri-list" || t === "text/plain");
