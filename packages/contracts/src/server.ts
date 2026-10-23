import * as Schema from "effect/Schema";

/**
 * Who keeps the service process alive. The service learns it from
 * XTEND_SUPERVISOR, which the desktop sets on a child it spawned and the
 * launchd unit sets in its plist; anything else (pnpm dev, a shell) is "none".
 */
export const ServiceSupervisor = Schema.Literals(["child", "launchd", "none"]);
export type ServiceSupervisor = typeof ServiceSupervisor.Type;

export const ServerInfo = Schema.Struct({
  name: Schema.Literal("xtend"),
  version: Schema.String,
  /** Where the service keeps its state; the UI shows it in Settings. */
  baseDir: Schema.String,
  /** Interface the service bound; loopback unless --host was given. */
  host: Schema.String,
  supervisor: ServiceSupervisor,
});
export type ServerInfo = typeof ServerInfo.Type;
