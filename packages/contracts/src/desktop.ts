import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { XId } from "./baseSchemas.ts";

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
} satisfies Record<DesktopCommand["type"], number>;

export const DesktopCommandResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("sessionScreenshot"), pngBase64: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sessionPost"), postId: XId }),
  Schema.Struct({ type: Schema.Literal("sessionNavigate") }),
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
