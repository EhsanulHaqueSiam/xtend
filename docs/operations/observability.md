# Observability

The service writes its own diagnostics. Nothing here leaves the machine unless you set an OTLP
endpoint.

- **Logs** go to stdout. The desktop pipes a child service's stdout to `<baseDir>/service.log`;
  launchd sends it to the same file. A log written inside a span is also kept in the trace file, as
  an event on that span.
- **Traces**: every completed span is one NDJSON line in `<baseDir>/logs/service.trace.ndjson`
  (`~/.xtend/logs/...` for the installed app, `<repo>/.xtend/logs/...` for `pnpm dev`).
- **Metrics** live in the process and are exported only over OTLP.

## Reading it

`xtend trace` reads the trace file and its rotated backups directly, so it works with the service
stopped or stuck. It prints count, p50, p95, max, failures and interrupts per span name, then the
latest failures with their error tag and trace id.

```bash
xtend trace --since 1h
xtend --base-dir .xtend trace --since 30m --limit 40   # a dev run
```

`xtend doctor` checks the base dir, the database (opened read-only, migration level), the service
on its port, the trace file's age, the treg token (where it is set, never the value), `claude` and
`codex` on the login shell's PATH, and the launchd agent. It never writes, starts a service, calls
X or spends; it exits 1 when a check fails.

For anything the summary does not answer, use `jq`:

```bash
F=~/.xtend/logs/service.trace.ndjson
jq -c 'select(.exit._tag == "Failure") | {name, errorTag: .exit.errorTag, traceId}' "$F"
jq -c 'select(.durationMs > 1000) | {name, durationMs, traceId}' "$F"
jq -r 'select(.traceId == "TRACE_ID") | [.name, .spanId, .parentSpanId // "-", .durationMs] | @tsv' "$F"
jq -c 'select(.attributes["x.purpose"]) | {purpose: .attributes["x.purpose"], cost: .attributes["x.cost_usd"]}' "$F"
```

A record has `name`, `traceId`, `spanId`, `parentSpanId`, `durationMs`, `attributes`, `events` (logs,
with `effect.logLevel`) and `exit` (`Success`, or `Failure`/`Interrupted` with `errorTag` and the
`cause`). The shape is `TraceRecord` in `apps/server/src/observability/LocalTrace.ts`.

What is spanned: every RPC (`ws.rpc.<method>`, `http.rpc.<method>`), every HTTP request
(`http GET /api/rpc/:method`, named by the route template the router matched, never the raw path), every `Effect.fn` service operation, every SQL statement (`sqlite`, query
text cut to 200 characters), and every treg call (`Treg.call` with `x.purpose`, `x.endpoint`,
`x.cost_usd`, `x.cached`).

## Secrets

Neither the trace file, `service.log` (stdout) nor an OTLP backend may receive the treg token, the service token, X cookies
(`auth_token`, `ct0`, `twid`, `kdt`), assist keys or webhook secrets. The service's tracer scrubs
every span before anything sees it, with the trace file on or off:

- a key names a credential by its last word or two (`tregToken`, `auth_token`, `webhookSecret`,
  `apiKey`, `ct0`, `csrf`, `sessionId`, `password_hash`; not `tokenCount`, `token_budget` or
  `userId`), and its value, whatever its type except a
  boolean, becomes `<redacted>`, in attributes, event attributes and nested values alike;
- log arguments are sanitised the same way before Effect formats them into the event's name;
- every string, span names included, is scrubbed in one linear pass for JWT-shaped values (treg
  tokens), `trg_` tokens, 64-hex service tokens, `Bearer` values and credential-named
  `key=value` / `"key": "value"` pairs, and only then cut to 2,000 characters, so a cut never
  leaves part of a token;
- failure and defect values are sanitised as structures before a cause is formatted, so a failed
  span's exit, a logged cause and OTLP's exception events never show them. An error keeps its
  name, message, call sites (on their own budget) and its `cause` chain, all scrubbed.

Stdout gets the same treatment, since the desktop pipes it to `<baseDir>/service.log`: the
console logger is swapped for one with the same line format whose message, cause and annotations
are sanitised.

The trace file is made `0600` before each append, including one that already existed; if that
fails, nothing is written. A new credential name or shape goes in `LocalTrace.ts` with a case in
its test.

## Environment

| Variable                        | Default                               |                                                                       |
| ------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `XTEND_TRACE_FILE`              | `<baseDir>/logs/service.trace.ndjson` | Trace file path                                                       |
| `XTEND_TRACE_DISABLED`          | off                                   | Kill switch for the local trace file                                  |
| `XTEND_TRACE_MAX_BYTES`         | `10485760`                            | Rotate past this size                                                 |
| `XTEND_TRACE_MAX_FILES`         | `5`                                   | Rotated backups kept (`.1` newest)                                    |
| `XTEND_TRACE_BATCH_WINDOW_MS`   | `1000`                                | Flush interval                                                        |
| `XTEND_OTLP_TRACES_URL`         | unset                                 | OTLP/HTTP JSON trace endpoint, e.g. `http://localhost:4318/v1/traces` |
| `XTEND_OTLP_METRICS_URL`        | unset                                 | OTLP/HTTP JSON metrics endpoint                                       |
| `XTEND_OTLP_EXPORT_INTERVAL_MS` | `10000`                               | Export interval                                                       |
| `XTEND_OTEL_SDK_DISABLED`       | unset                                 | Kill switch for all OTLP export; wins over `OTEL_SDK_DISABLED=true`   |

The service reads these at start; restart it after a change. OTLP export reports as service
`xtend-service`. `docker run --rm -p 3000:3000 -p 4318:4318 grafana/otel-lgtm` is a local backend.

## Stalls, defects, heap snapshots

- Every 30 s the event loop is sampled. A stall over 2 s (not counting time the Mac slept) is a root
  `service.eventLoop.stall` span with a warning and CPU, page fault and RSS attributes, and counts
  in `xtend_event_loop_stalls_total`. The first window, which covers migrations, is skipped.
- A defect (an unexpected error, not a typed failure) that reaches the socket or HTTP server is
  logged as `Unhandled defect` with its cause, on the span it happened in. Every failed span keeps
  its cause in `exit` either way.
- `kill -USR2 <pid>` writes `<baseDir>/logs/service-<pid>-<time>.heapsnapshot`; open it in Chrome
  DevTools, Memory, Load. Find the pid with `lsof -nP -iTCP:4820 -sTCP:LISTEN` and check it with
  `ps -p <pid> -o command=` first: a process without the handler (the desktop) exits on SIGUSR2.
  The service pauses while it writes, needs about the heap's size in free memory, and the file holds
  everything in memory, tokens included. Do not share it; delete it when done.

## Adding spans and metrics

- Name a reusable function with `Effect.fn("Service.operation")`; that is the span. Put ids and
  detail on it with `Effect.annotateCurrentSpan`, and log inside it so the log lands on the span.
- Metrics are in `apps/server/src/observability/Metrics.ts`, attached with the pipeable
  `withMetrics(...)` or `withJobMetrics("area.job")` for a scheduler tick. Labels stay
  low-cardinality (method, transport, purpose area, job, outcome); ids and text go on spans.

Current metrics: `xtend_rpc_requests_total` and `xtend_rpc_request_duration` (method, transport,
outcome), `xtend_x_calls_total` and `xtend_x_spend_usd` (purpose area, outcome), `xtend_job_runs_total`
and `xtend_job_run_duration` (job, outcome), `xtend_event_loop_stalls_total`.
