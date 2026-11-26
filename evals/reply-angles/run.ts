#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- an eval script: it reads flags and writes run files.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as Assist from "../../apps/server/src/ai/Assist.ts";
import * as ServerConfig from "../../apps/server/src/config.ts";
import { readPostRequest } from "../../apps/server/src/engage/Engage.ts";
import * as Sqlite from "../../apps/server/src/persistence/Sqlite.ts";
import * as SettingsStore from "../../apps/server/src/settings/SettingsStore.ts";
import * as TokenCipher from "../../apps/server/src/settings/TokenCipher.ts";
import { cases, type Case } from "./cases.ts";
import { grade } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "" },
    provider: { type: "string", default: "claude" },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "3" },
    baseline: { type: "string" },
  },
});
if (!values.out)
  throw new Error(
    "Use --out <dir> [--model <id>] [--provider claude|codex] [--case <id>] [--samples N] [--baseline <results.ndjson>].",
  );
const provider = Schema.decodeUnknownSync(Schema.Literals(["claude", "codex"]))(values.provider);
const outDirectory = values.out;
const selected = values.case ? cases.filter((entry) => values.case!.includes(entry.id)) : cases;
if (selected.length === 0) throw new Error(`No case matches ${values.case?.join(", ")}.`);

const request = (entry: Case) =>
  readPostRequest({
    post: entry.post,
    images: [],
    thread: entry.thread ?? [],
    replies: entry.replies ?? [],
    correction: entry.correction,
    own: entry.own ?? [],
  });
const { instructions } = request(selected[0]!);
const promptHash = NodeCrypto.createHash("sha256").update(instructions).digest("hex").slice(0, 12);

// Assist exactly as the service builds it, on an empty in-memory settings store: the user's own
// Claude or Codex login answers, so a run needs no API key.
const assistLayer = Assist.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      NodeServices.layer,
      FetchHttpClient.layer,
      TokenCipher.layerTest,
      ServerConfig.layer({
        version: "eval",
        port: 0,
        host: "127.0.0.1",
        baseDir: "/nonexistent",
        dbPath: ":memory:",
        staticDir: undefined,
        devUrl: undefined,
        supervisor: "none",
        allowedOrigins: [],
      }),
    ),
  ),
);

const sample = Effect.fn("evaluateReplyAngles.sample")(function* (entry: Case, n: number) {
  const assist = yield* Assist.Assist;
  const [duration, result] = yield* assist
    .generate(request(entry))
    .pipe(Effect.result, Effect.timed);
  const row = { case: entry.id, sample: n, ms: Duration.toMillis(duration) };
  if (Result.isFailure(result)) return { ...row, error: result.failure.message };
  const topReplies = (entry.replies ?? []).map((r) => r.text);
  return {
    ...row,
    ...grade(result.success, { topReplies, expect: entry.expect }),
    read: result.success,
  };
});

const Row = Schema.Struct({ case: Schema.String, pass: Schema.optional(Schema.Boolean) });
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.fromJsonString(Row)));
const encodeRow = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Passing samples over all samples, per case. A run error counts as a failed sample. */
const tally = (rows: ReadonlyArray<typeof Row.Type>) => {
  const byCase = new Map<string, { passes: number; total: number }>();
  for (const row of rows) {
    const own = byCase.get(row.case) ?? { passes: 0, total: 0 };
    byCase.set(row.case, {
      passes: own.passes + (row.pass === true ? 1 : 0),
      total: own.total + 1,
    });
  }
  return byCase;
};
const verdict = (count: { passes: number; total: number } | undefined) =>
  count === undefined
    ? "-"
    : `${count.passes > count.total / 2 ? "pass" : "FAIL"} ${count.passes}/${count.total}`;

// Read before the run writes anything: --baseline may be the results.ndjson this run replaces.
const before = values.baseline
  ? tally(
      decodeRows(
        NodeFS.readFileSync(values.baseline, "utf8")
          .split("\n")
          .filter((line) => line !== ""),
      ),
    )
  : undefined;

const rows = await Effect.runPromise(
  Effect.gen(function* () {
    const settings = yield* SettingsStore.SettingsStore;
    yield* settings.update({ assistProvider: provider, assistModel: values.model });
    return yield* Effect.forEach(
      selected.flatMap((entry) =>
        Array.from({ length: Number(values.samples) }, (_, n) => ({ entry, n })),
      ),
      ({ entry, n }) => sample(entry, n),
      { concurrency: Number(values.concurrency) },
    );
  }).pipe(
    Effect.provide(assistLayer),
    // The in-memory database logs its migrations; the summary is the run's only output.
    Effect.provideService(References.MinimumLogLevel, "Warn"),
  ),
);

NodeFS.mkdirSync(outDirectory, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(outDirectory, "results.ndjson"),
  rows.map((row) => encodeRow(row)).join("\n") + "\n",
);
const now = tally(rows);
const lines = [
  `${provider} ${values.model || "(CLI default model)"}, prompt ${promptHash}, ${instructions.split(/\s+/).length} words`,
  "",
  "| case | source | now | baseline | failures |",
  "|---|---|---|---|---|",
  ...selected.map((entry) => {
    const own = rows.filter((row) => row.case === entry.id);
    const reasons = [
      ...new Set(own.flatMap((row) => ("failures" in row ? row.failures : [row.error]))),
    ];
    return `| ${entry.id} | ${entry.source} | ${verdict(now.get(entry.id))} | ${verdict(before?.get(entry.id))} | ${reasons.join("; ")} |`;
  }),
  "",
  `${rows.length} samples, ${Math.round(rows.reduce((sum, row) => sum + row.ms, 0) / 1000)}s of model time.`,
];
const summary = lines.join("\n") + "\n";
NodeFS.writeFileSync(NodePath.join(outDirectory, "summary.md"), summary);
process.stdout.write(summary);
