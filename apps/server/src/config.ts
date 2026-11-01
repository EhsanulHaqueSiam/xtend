import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ServiceSupervisor } from "@xtend/contracts";

import packageJson from "../package.json" with { type: "json" };

const decodeSupervisor = Schema.decodeUnknownOption(ServiceSupervisor);

const DEFAULT_PORT = 4820;

export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly version: string;
    readonly port: number;
    readonly host: string;
    readonly baseDir: string;
    readonly dbPath: string;
    /** Built web app, served when no dev URL is set. */
    readonly staticDir: string | undefined;
    readonly devUrl: URL | undefined;
    /** Who restarts the process: set by the desktop (child) or the launchd plist. */
    readonly supervisor: ServiceSupervisor;
  }
>()("xtend/config/ServerConfig") {}

export const layer = (config: ServerConfig["Service"]) => Layer.succeed(ServerConfig)(config);

export interface ResolveOptions {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly baseDir?: string | undefined;
  readonly devUrl?: URL | undefined;
}

/** Paths derive from one base directory so a `--base-dir` moves everything together. */
export const resolve = Effect.fn("ServerConfig.resolve")(function* (options: ResolveOptions) {
  const path = yield* Path.Path;
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const baseDir = path.resolve(
    options.baseDir ?? process.env.XTEND_HOME ?? path.join(homeDir, ".xtend"),
  );
  const staticDir = path.resolve(import.meta.dirname, "..", "..", "web", "dist");
  return ServerConfig.of({
    version: packageJson.version,
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? "127.0.0.1",
    baseDir,
    dbPath: path.join(baseDir, "xtend.sqlite"),
    staticDir: options.devUrl === undefined ? staticDir : undefined,
    devUrl: options.devUrl,
    supervisor: decodeSupervisor(process.env.XTEND_SUPERVISOR).pipe(
      Option.getOrElse(() => "none" as const),
    ),
  });
});

const TRUE_WORDS = new Set(["true", "1", "yes", "on", "y"]);
const flag = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(Option.map((value) => TRUE_WORDS.has(value.trim().toLowerCase()))),
  );
const blankAsNone = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map(Option.filter((value) => value.trim() !== "")),
  );

const ObservabilityEnv = Config.all({
  traceFile: blankAsNone("XTEND_TRACE_FILE"),
  traceDisabled: flag("XTEND_TRACE_DISABLED"),
  traceMaxBytes: Config.Int("XTEND_TRACE_MAX_BYTES").pipe(Config.withDefault(10 * 1024 * 1024)),
  traceMaxFiles: Config.Int("XTEND_TRACE_MAX_FILES").pipe(Config.withDefault(5)),
  traceBatchWindowMs: Config.Int("XTEND_TRACE_BATCH_WINDOW_MS").pipe(Config.withDefault(1000)),
  otlpTracesUrl: blankAsNone("XTEND_OTLP_TRACES_URL"),
  otlpMetricsUrl: blankAsNone("XTEND_OTLP_METRICS_URL"),
  otlpExportIntervalMs: Config.Int("XTEND_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  xtendSdkDisabled: flag("XTEND_OTEL_SDK_DISABLED"),
  // The OpenTelemetry spec: only "true" disables.
  otelSdkDisabled: Config.String("OTEL_SDK_DISABLED").pipe(
    Config.map((value) => value.trim().toLowerCase() === "true"),
    Config.withDefault(false),
  ),
});

/**
 * Where the service writes its own diagnostics and what it exports, from the environment.
 * Everything sits under `<baseDir>/logs`, so a dev run's `--base-dir` keeps its traces apart.
 */
export const observability = Effect.fn("ServerConfig.observability")(function* (baseDir: string) {
  const path = yield* Path.Path;
  const env = yield* ObservabilityEnv;
  const logsDir = path.join(baseDir, "logs");
  // XTEND_OTEL_SDK_DISABLED wins when set, so =false re-enables export under a global OTEL_SDK_DISABLED.
  const otlpOff = Option.getOrElse(env.xtendSdkDisabled, () => env.otelSdkDisabled);
  const otlpUrl = (url: Option.Option<string>) =>
    otlpOff ? undefined : Option.getOrUndefined(url);
  return {
    logsDir,
    traceFile: Option.getOrElse(env.traceFile, () => path.join(logsDir, "service.trace.ndjson")),
    traceEnabled: !Option.getOrElse(env.traceDisabled, () => false),
    traceMaxBytes: Math.max(1024, env.traceMaxBytes),
    traceMaxFiles: Math.max(1, env.traceMaxFiles),
    traceBatchWindowMs: Math.max(10, env.traceBatchWindowMs),
    otlpTracesUrl: otlpUrl(env.otlpTracesUrl),
    otlpMetricsUrl: otlpUrl(env.otlpMetricsUrl),
    otlpExportIntervalMs: Math.max(1000, env.otlpExportIntervalMs),
  };
});
