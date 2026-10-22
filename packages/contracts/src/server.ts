import * as Schema from "effect/Schema";

export const ServerInfo = Schema.Struct({
  name: Schema.Literal("corvid"),
  version: Schema.String,
  /** Where the service keeps its state; the UI shows it in Settings. */
  baseDir: Schema.String,
});
export type ServerInfo = typeof ServerInfo.Type;
