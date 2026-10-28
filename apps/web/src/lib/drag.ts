import type { XPost } from "@xtend/contracts";

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

/** The drag type a draft card carries between the board, the Ready list and the calendar: its id. */
export const DRAFT_TYPE = "application/x-xtend-draft";

/**
 * The drag type a Library card adds beside its URL, so a collection row knows a card is
 * over it. It carries no data: a drop from another window could forge a body, so the
 * post itself travels through `draggedPost`, set only by a card in this app.
 */
export const POST_TYPE = "application/x-xtend-post";

/** A Leads person on the move: the data is its id. */
export const PERSON_TYPE = "application/x-xtend-person";

let dragged: XPost | null = null;

/** The card this app is dragging right now, or null; a drop never trusts the payload instead. */
export const draggedPost = {
  start: (post: XPost) => {
    dragged = post;
  },
  end: () => {
    dragged = null;
  },
  current: () => dragged,
};
