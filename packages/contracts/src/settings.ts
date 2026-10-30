import * as Schema from "effect/Schema";

import { IsoDateTime, XHandle } from "./baseSchemas.ts";

/**
 * Everything the user can change about how the service behaves. One row per
 * install; accounts beyond the connected handle come later.
 */
export const AssistProvider = Schema.Literals(["claude", "codex", "endpoint"]);
export type AssistProvider = typeof AssistProvider.Type;

export const Settings = Schema.Struct({
  /** The X account treg is connected to. Null until Settings reads it from treg. */
  handle: Schema.NullOr(XHandle),
  /** Set when the user pasted a token; otherwise the service falls back to XTEND_TREG_TOKEN or the treg CLI login. */
  tregTokenSet: Schema.Boolean,
  /** Hard stop for paid calls per calendar month. */
  monthlyBudgetUsd: Schema.Number,
  /** Desktop only: let media posts go through the logged-in x.com session. */
  sessionPostingEnabled: Schema.Boolean,
  /** The Library's paid morning jobs (picks, hooks, ready-to-post); off until the user opts in. */
  dailyLibraryJobs: Schema.Boolean,
  /** Short description of what the account is about; the assistant writes in this voice. */
  voiceNotes: Schema.String,
  /** Niche keywords the library, leads and engage screens search by default. */
  keywords: Schema.Array(Schema.String),
  /** IANA zone every slot, calendar and heatmap is expressed in. Defaults to the service machine's zone. */
  timeZone: Schema.String,
  /** What answers assist: the Claude or Codex login on the service machine, as T3 Code runs them, or an OpenAI-compatible endpoint. None is billed through Xtend. */
  assistProvider: AssistProvider,
  /** The endpoint when `assistProvider` is "endpoint" (local Ollama, a provider with the user's key). */
  assistBaseUrl: Schema.NullOr(Schema.String),
  assistModel: Schema.String,
  /** The command for the Claude or Codex CLI, like T3 Code's binary path; empty finds `claude` or `codex` on the login shell's PATH. */
  assistBinaryPath: Schema.String,
  assistKeySet: Schema.Boolean,
  /** Push public sightings to the shared pool. Off stops the push and keeps reading trends. */
  poolSharing: Schema.Boolean,
});
export type Settings = typeof Settings.Type;

export const SettingsUpdate = Schema.Struct({
  handle: Schema.optional(Schema.NullOr(XHandle)),
  tregToken: Schema.optional(Schema.NullOr(Schema.String)),
  monthlyBudgetUsd: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  sessionPostingEnabled: Schema.optional(Schema.Boolean),
  dailyLibraryJobs: Schema.optional(Schema.Boolean),
  voiceNotes: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  timeZone: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  assistProvider: Schema.optional(AssistProvider),
  assistBaseUrl: Schema.optional(Schema.NullOr(Schema.String)),
  assistModel: Schema.optional(Schema.String),
  assistBinaryPath: Schema.optional(Schema.String),
  assistKey: Schema.optional(Schema.NullOr(Schema.String)),
  poolSharing: Schema.optional(Schema.Boolean),
});
export type SettingsUpdate = typeof SettingsUpdate.Type;

/** Every paid call the service made, so the UI can show a live meter and the budget can stop things. */
export const SpendEntry = Schema.Struct({
  at: IsoDateTime,
  provider: Schema.Literals(["treg", "claude"]),
  endpoint: Schema.String,
  /** Which screen or automation asked. */
  purpose: Schema.String,
  costUsd: Schema.Number,
});
export type SpendEntry = typeof SpendEntry.Type;

export const SpendSummary = Schema.Struct({
  monthUsd: Schema.Number,
  todayUsd: Schema.Number,
  monthlyBudgetUsd: Schema.Number,
  byPurpose: Schema.Array(Schema.Struct({ purpose: Schema.String, costUsd: Schema.Number })),
  recent: Schema.Array(SpendEntry),
});
export type SpendSummary = typeof SpendSummary.Type;

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  operation: Schema.Literals(["get", "update", "spend"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Settings failed during ${this.operation}.`;
  }
}
