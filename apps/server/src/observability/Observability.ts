import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

// Ids in a path (`/api/webhooks/12`) would give every rule its own span name.
const layerHttpSpanNames = Layer.succeed(HttpMiddleware.SpanNameGenerator)((request) => {
  const path = new URL(request.url, "http://x").pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
  return `http ${request.method} ${path}`;
});

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
        if (!settings.traceEnabled)
          return delegate === undefined ? Layer.empty : Layer.succeed(Tracer.Tracer)(delegate);
        const sink = yield* LocalTrace.makeTraceSink({
          filePath: settings.traceFile,
          maxBytes: settings.traceMaxBytes,
          maxFiles: settings.traceMaxFiles,
          batchWindowMs: settings.traceBatchWindowMs,
        });
        return Layer.succeed(Tracer.Tracer)(LocalTrace.makeLocalFileTracer(sink, delegate));
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
          DefectReporter.layer,
        ),
      ),
      Layer.provide(OtlpSerialization.layerJson),
      Layer.provide(NodeHttpClient.layerNodeHttp),
    );
  }),
);
