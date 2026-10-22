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
});
export type DesktopCommandCompletion = typeof DesktopCommandCompletion.Type;

export class DesktopUnavailableError extends Schema.TaggedError<DesktopUnavailableError>()(
  "DesktopUnavailableError",
  {
    reason: Schema.Literals(["no_desktop", "timeout", "failed"]),
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
