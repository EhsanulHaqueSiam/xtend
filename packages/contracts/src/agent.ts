import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const ThreadStatus = Schema.Literals(["idle", "running"]);
export type ThreadStatus = typeof ThreadStatus.Type;

export const ThreadSummary = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  status: ThreadStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadSummary = typeof ThreadSummary.Type;

/**
 * What a thread remembers. Append-only; the UI folds these into a transcript.
 * Tool input and output travel as text so the wire never carries raw payloads.
 */
export const ThreadEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("user_message"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("turn_started") }),
  Schema.Struct({ type: Schema.Literal("assistant_text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool_call"),
    toolName: Schema.String,
    input: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    toolName: Schema.String,
    output: Schema.String,
    isError: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("turn_finished"),
    ok: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    costUsd: Schema.NullOr(Schema.Number),
  }),
]);
export type ThreadEvent = typeof ThreadEvent.Type;

export const ThreadEventRecord = Schema.Struct({
  sequence: NonNegativeInt,
  threadId: ThreadId,
  at: IsoDateTime,
  event: ThreadEvent,
});
export type ThreadEventRecord = typeof ThreadEventRecord.Type;

export const ThreadsCreateInput = Schema.Struct({
  title: Schema.optional(Schema.String),
});
export const ThreadsListResult = Schema.Struct({ threads: Schema.Array(ThreadSummary) });
export const ThreadsSendInput = Schema.Struct({ threadId: ThreadId, text: Schema.String });
export const ThreadsEventsInput = Schema.Struct({
  threadId: ThreadId,
  /** Replay from this sequence (exclusive). Omit for the whole history. */
  afterSequence: Schema.optional(NonNegativeInt),
});
export const ThreadsEventsResult = Schema.Struct({ events: Schema.Array(ThreadEventRecord) });

export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} does not exist.`;
  }
}

export class ThreadBusyError extends Schema.TaggedError<ThreadBusyError>()("ThreadBusyError", {
  threadId: ThreadId,
}) {
  override get message(): string {
    return `Thread ${this.threadId} is already running a turn.`;
  }
}

export class ThreadStoreError extends Schema.TaggedError<ThreadStoreError>()("ThreadStoreError", {
  operation: Schema.Literals(["create", "list", "append", "events", "session"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Thread store failed during ${this.operation}.`;
  }
}

/** Work the service asks the connected desktop to do, because only the desktop holds the X session. */
export const DesktopCommandId = Schema.String.pipe(Schema.brand("DesktopCommandId"));
export type DesktopCommandId = typeof DesktopCommandId.Type;

export const DesktopCommand = Schema.Struct({
  commandId: DesktopCommandId,
  kind: Schema.Literal("sessionScreenshot"),
});
export type DesktopCommand = typeof DesktopCommand.Type;

export const DesktopCommandResult = Schema.Struct({
  commandId: DesktopCommandId,
  /** PNG, base64. Null when the desktop could not capture. */
  pngBase64: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type DesktopCommandResult = typeof DesktopCommandResult.Type;

export class DesktopUnavailableError extends Schema.TaggedError<DesktopUnavailableError>()(
  "DesktopUnavailableError",
  { reason: Schema.Literals(["not_connected", "timed_out", "failed"]) },
) {
  override get message(): string {
    return `The desktop could not run the command: ${this.reason}.`;
  }
}
