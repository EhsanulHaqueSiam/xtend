import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { XHandle, XId } from "./baseSchemas.ts";

/**
 * Marks: what Xtend already knows about a post, from local data only. One query
 * per batch of posts on screen; the x.com overlay and every tool row draw the
 * same marks the same way.
 */

export const Mark = Schema.Struct({
  kind: Schema.Literals(["replied", "saved", "lead", "watching", "auto"]),
  /** The lead's stage or the rule's name; null for the other kinds. */
  detail: Schema.NullOr(Schema.String),
  /** When the reply or run happened; null when the mark is a standing state. */
  at: Schema.NullOr(Schema.String),
});
export type Mark = typeof Mark.Type;

/** Lead and watching marks hang on the author, so each post names its handle. */
export const MarkSubject = Schema.Struct({ postId: XId, handle: XHandle });
export type MarkSubject = typeof MarkSubject.Type;

export const Marks_METHODS = {
  forPosts: "marks.forPosts",
} as const;

export const MarksRpcGroup = RpcGroup.make(
  Rpc.make(Marks_METHODS.forPosts, {
    payload: Schema.Struct({ posts: Schema.Array(MarkSubject) }),
    /** Marks per post id; posts without any are absent. */
    success: Schema.Record(Schema.String, Schema.Array(Mark)),
  }),
);
