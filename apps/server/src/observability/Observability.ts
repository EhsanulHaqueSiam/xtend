import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Tracer from "effect/Tracer";
import { HttpMiddleware, UrlParams } from "effect/http";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpMetrics from "effect/observability/OtlpMetrics";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as OtlpTracer from "effect/observability/OtlpTracer";

import * as ServerConfig from "../config.ts";
import * as DefectReporter from "./DefectReporter.ts";
import * as EventLoopMonitor from "./EventLoopMonitor.ts";
import * as HeapSnapshot from "./HeapSnapshot.ts";
import * as LocalTrace from "./LocalTrace.ts";

// The socket and the packaged web page carry the service token as `?token=`.
const layerRedactedParams = Layer.succeed(UrlParams.CurrentRedactedNames)([
  ...UrlParams.CurrentRedactedNames.defaultValue(),
  "token",
]);

// Same loggers, with Effect's tracer and console loggers swapped for ones that sanitise.
const SANITISED: ReadonlyArray<
  readonly [Logger.Logger<unknown, void>, Logger.Logger<unknown, void>]
> = [
  [Logger.tracerLogger, LocalTrace.tracerLogger],
  [Logger.defaultLogger, LocalTrace.consoleLogger],
];
export const layerLoggers = Layer.unwrap(
  Effect.map(Effect.service(Logger.CurrentLoggers), (current) =>
    Layer.succeed(Logger.CurrentLoggers)(
      new Set(
        [...current].map(
          (logger) => SANITISED.find(([builtIn]) => builtIn === logger)?.[1] ?? logger,
        ),
      ),
    ),
  ),
);

// A path is not a span name (ids, `?token=`); the span adds the route template the router matched.
export const layerHttpSpanNames = Layer.succeed(HttpMiddleware.SpanNameGenerator)(
  (request) => `http ${request.method}`,
);

/**
 * Tracing, metrics and diagnostics for the service: the local trace file, optional OTLP export,
 * defect logging, the event loop monitor and heap snapshots on SIGUSR2. Logs keep Effect's
 * default loggers, whose tracer logger turns a log inside a span into a span event.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const settings = yield* ServerConfig.observability(config.baseDir);
    const resource = { serviceName: "xtend-service", serviceVersion: config.version };

    const layerTracer = Layer.unwrap(
      Effect.gen(function* () {
        const delegate =
          settings.otlpTracesUrl === undefined
            ? undefined
            : yield* OtlpTracer.make({
                url: settings.otlpTracesUrl,
                exportInterval: `${settings.otlpExportIntervalMs} millis`,
                resource,
              });
        const sink = settings.traceEnabled
          ? yield* LocalTrace.makeTraceSink({
              filePath: settings.traceFile,
              maxBytes: settings.traceMaxBytes,
              maxFiles: settings.traceMaxFiles,
              batchWindowMs: settings.traceBatchWindowMs,
            })
          : undefined;
        // Scrubbing wraps the OTLP exporter too, so it holds with the trace file off.
        return Layer.succeed(Tracer.Tracer)(LocalTrace.makeTracer({ push: sink?.push, delegate }));
      }),
    ).pipe(Layer.provide(OtlpExporter.layerFlusher));

    const layerMetrics =
      settings.otlpMetricsUrl === undefined
        ? Layer.empty
        : OtlpMetrics.layer({
            url: settings.otlpMetricsUrl,
            exportInterval: `${settings.otlpExportIntervalMs} millis`,
            resource,
          });

    return Layer.mergeAll(EventLoopMonitor.layer, HeapSnapshot.layer(settings.logsDir)).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layerTracer,
          layerMetrics,
          layerRedactedParams,
          layerHttpSpanNames,
          layerLoggers,
          DefectReporter.layer,
        ),
      ),
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(NodeHttpClient.layerNodeHttp),
    );
  }),
);
