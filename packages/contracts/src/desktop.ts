import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { XId } from "./baseSchemas.ts";
import type { ObservedPost } from "./observation.ts";

/**
 * Desktop contracts. The service cannot touch the x.com session itself, so it
 * asks the connected desktop over a command stream and waits for the answer.
 * Owned by the desktop area.
 */

export const DesktopCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("sessionScreenshot") }),
  /** Drives x.com's own composer in the session view; honoured only when settings.sessionPostingEnabled. */
  Schema.Struct({
    type: Schema.Literal("sessionPost"),
    text: Schema.String,
    mediaPaths: Schema.Array(Schema.String),
    replyToPostId: Schema.optional(XId),
  }),
  Schema.Struct({ type: Schema.Literal("sessionNavigate"), url: Schema.String }),
  /** Clicks X's own like on the post's page in the session view; same setting as sessionPost. */
  Schema.Struct({ type: Schema.Literal("sessionLike"), postId: XId }),
  /** Sends a DM through X's own message composer in the session view; same setting as sessionPost. */
  Schema.Struct({ type: Schema.Literal("sessionDm"), userId: XId, text: Schema.String }),
]);
export type DesktopCommand = typeof DesktopCommand.Type;

/**
 * How long the desktop may spend on a command, counted from when it receives it. It gives up by
 * then and says why; the service waits a little longer for that answer. A session post loads X's
 * composer, uploads its media (a video can take minutes) and waits for X to confirm.
 */
export const DESKTOP_COMMAND_LIMIT_MS = {
  sessionScreenshot: 20_000,
  sessionNavigate: 20_000,
  sessionPost: 180_000,
  sessionLike: 30_000,
  sessionDm: 45_000,
} satisfies Record<DesktopCommand["type"], number>;

export const DesktopCommandResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("sessionScreenshot"), pngBase64: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sessionPost"), postId: XId }),
  Schema.Struct({ type: Schema.Literal("sessionNavigate") }),
  Schema.Struct({ type: Schema.Literal("sessionLike") }),
  Schema.Struct({ type: Schema.Literal("sessionDm") }),
]);
export type DesktopCommandResult = typeof DesktopCommandResult.Type;

/** The result the desktop answers for a command of the same `type`. */
export type DesktopCommandResultFor<C extends DesktopCommand> = Extract<
  DesktopCommandResult,
  { type: C["type"] }
>;

export const DesktopCommandRequest = Schema.Struct({
  id: Schema.String,
  command: DesktopCommand,
});
export type DesktopCommandRequest = typeof DesktopCommandRequest.Type;

export const DesktopCommandCompletion = Schema.Struct({
  id: Schema.String,
  result: Schema.NullOr(DesktopCommandResult),
  /** Why the desktop could not run the command; set only when `result` is null. */
  error: Schema.NullOr(Schema.String),
  /** The desktop refused before touching the session view, so nothing went to X and sending it again is safe. */
  notAttempted: Schema.optional(Schema.Boolean),
});
export type DesktopCommandCompletion = typeof DesktopCommandCompletion.Type;

export class DesktopUnavailableError extends Schema.TaggedError<DesktopUnavailableError>()(
  "DesktopUnavailableError",
  {
    reason: Schema.Literals(["no_desktop", "timeout", "failed", "not_attempted"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Desktop ${this.reason}: ${this.detail}`;
  }
}

export const Desktop_METHODS = {
  subscribeCommands: "desktop.subscribeCommands",
  completeCommand: "desktop.completeCommand",
} as const;

export const DesktopRpcGroup = RpcGroup.make(
  Rpc.make(Desktop_METHODS.subscribeCommands, {
    payload: Schema.Struct({}),
    success: DesktopCommandRequest,
    stream: true,
  }),
  Rpc.make(Desktop_METHODS.completeCommand, {
    payload: DesktopCommandCompletion,
    success: Schema.Void,
  }),
);

/** A photo, video or GIF on a post, as X serves it; `videoUrl` is its best mp4. */
export interface EngineMedia {
  readonly kind: "photo" | "video" | "gif";
  readonly url: string;
  readonly videoUrl: string | null;
  readonly width: number;
  readonly height: number;
}

/**
 * A post as Xtend's own X screens draw it: the observed post plus what drawing needs. It goes
 * from the desktop to the app page only, never to the service or the pool.
 */
export interface EnginePost extends ObservedPost {
  readonly avatarUrl: string | null;
  readonly media: ReadonlyArray<EngineMedia>;
  readonly quotedId: string | null;
  readonly replyToId: string | null;
}

/** One GraphQL response the engine received, by operation (HomeTimeline, TweetDetail, ...). */
export interface EngineBatch {
  readonly op: string;
  readonly posts: ReadonlyArray<EnginePost>;
}
