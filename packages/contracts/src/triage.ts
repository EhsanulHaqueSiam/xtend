import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

/**
 * Triage: what a coding agent on the user's machine needs to investigate a problem. `xtend triage`
 * and Settings, Diagnostics call the same service methods. Everything here is already scrubbed of
 * tokens, cookies, keys and post text.
 */

/** Where diagnostics live on the service's machine, for Settings to show. */
export const TriagePaths = Schema.Struct({
  baseDir: Schema.String,
  traceFile: Schema.String,
  serviceLog: Schema.String,
  desktopLog: Schema.String,
  triageDir: Schema.String,
});
export type TriagePaths = typeof TriagePaths.Type;

/** A triage folder just written, and the shell lines that start an agent in it. */
export const TriagePrepared = Schema.Struct({
  dir: Schema.String,
  contextFile: Schema.String,
  playbookFile: Schema.String,
  start: Schema.Struct({ claude: Schema.String, codex: Schema.String }),
});
export type TriagePrepared = typeof TriagePrepared.Type;

export class TriageError extends Schema.TaggedError<TriageError>()("TriageError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not write the triage folder ${this.path}.`;
  }
}

export const Triage_METHODS = {
  paths: "triage.paths",
  context: "triage.context",
  prepare: "triage.prepare",
} as const;

export const TriageRpcGroup = RpcGroup.make(
  Rpc.make(Triage_METHODS.paths, { payload: Schema.Struct({}), success: TriagePaths }),
  /** The context file's text, for the user to copy. Writes nothing. */
  Rpc.make(Triage_METHODS.context, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ text: Schema.String }),
  }),
  Rpc.make(Triage_METHODS.prepare, {
    payload: Schema.Struct({}),
    success: TriagePrepared,
    error: TriageError,
  }),
);
