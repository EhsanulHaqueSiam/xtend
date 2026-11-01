// @effect-diagnostics nodeBuiltinImport:off -- the OS release has no Effect module.
import * as NodeOS from "node:os";

import { redactText, TriageError, type TriagePaths, type TriagePrepared } from "@xtend/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { loginPath } from "../ai/loginPath.ts";
import * as Doctor from "../cli/doctor.ts";
import * as ServerConfig from "../config.ts";
import { formatTraceSummary, readTraceSummary } from "../diagnostics/TraceDiagnostics.ts";
import * as Launchd from "../service/launchd.ts";
import { PLAYBOOK } from "./playbook.ts";

/** What the agent is told in the triage folder; no apostrophe, so it single-quotes in a shell. */
export const LAUNCH_PROMPT =
  "Read PLAYBOOK.md in this folder and follow it; context.md beside it holds the machine facts. Start by asking what went wrong.";

const SUPERVISORS = {
  child: "the desktop app (it started the service as its child)",
  launchd: "launchd (`xtend service install`)",
  none: "a shell or `pnpm dev`",
} as const;

const decodeHealth = Schema.decodeUnknownEffect(
  Schema.Struct({
    version: Schema.String,
    supervisor: Schema.optional(Schema.Literals(["child", "launchd", "none"])),
  }),
);

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** stdout of a short local command, or "" when it is missing, fails or hangs. */
const output = Effect.fn("Triage.output")(
  function* (command: string, args: ReadonlyArray<string>) {
    const child = yield* ChildProcess.make(command, args, { stdin: "ignore", stderr: "ignore" });
    return yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
  },
  Effect.scoped,
  Effect.timeoutOrElse({ duration: Duration.seconds(3), orElse: () => Effect.succeed("") }),
  Effect.orElseSucceed(() => ""),
);

/** Memory and CPU of whatever listens on the service's port, from `lsof` and `ps`. */
const serviceProcess = Effect.fn("Triage.serviceProcess")(function* (port: number) {
  const pid = (yield* output("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]))
    .trim()
    .split("\n")[0];
  if (pid === undefined || !/^\d+$/.test(pid)) return `nothing listens on port ${port}`;
  const [rss, cpu, elapsed] = (yield* output("ps", ["-o", "rss=,%cpu=,etime=", "-p", pid]))
    .trim()
    .split(/\s+/);
  if (rss === undefined || cpu === undefined || elapsed === undefined)
    return `pid ${pid}; ps gave no figures`;
  return `pid ${pid}, ${Math.round(Number(rss) / 1024)} MB resident, ${cpu}% CPU, up ${elapsed}`;
});

/**
 * Builds and writes what a coding agent needs to investigate a problem on this machine.
 * `xtend triage` and Settings, Diagnostics both call it, the CLI with the service up or down.
 */
export class Triage extends Context.Service<
  Triage,
  {
    readonly paths: Effect.Effect<TriagePaths>;
    /** The context file's text, scrubbed like the trace file. Read-only. */
    readonly context: (from: "cli" | "app") => Effect.Effect<string>;
    /** Writes `<baseDir>/triage/<time>/` with the context and the playbook. */
    readonly prepare: (from: "cli" | "app") => Effect.Effect<TriagePrepared, TriageError>;
  }
>()("xtend/triage/Triage") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const platform = yield* Effect.context<
    | FileSystem.FileSystem
    | Path.Path
    | HttpClient.HttpClient
    | ChildProcessSpawner.ChildProcessSpawner
  >();
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const serviceUrl = process.env.XTEND_SERVICE_URL ?? `http://${config.host}:${config.port}`;
  const triageDir = path.join(config.baseDir, "triage");

  const paths = Effect.gen(function* () {
    const trace = yield* ServerConfig.observability(config.baseDir);
    return {
      baseDir: config.baseDir,
      traceFile: trace.traceFile,
      serviceLog: path.join(config.baseDir, "service.log"),
      desktopLog: path.join(trace.logsDir, "desktop.log"),
      triageDir,
    };
  }).pipe(Effect.provide(platform), Effect.orDie);

  const context = Effect.fn("Triage.context")(
    function* (from: "cli" | "app") {
      const where = yield* paths;
      const trace = yield* ServerConfig.observability(config.baseDir);
      const now = yield* Clock.currentTimeMillis;
      const health = yield* http.get(`${serviceUrl}/api/health`).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeHealth),
        Effect.timeout(Duration.seconds(2)),
        Effect.option,
      );
      const launchd = process.platform === "darwin" ? Launchd.status() : undefined;
      const checks = yield* Doctor.runDoctor({
        baseDir: config.baseDir,
        dbPath: config.dbPath,
        serviceUrl,
        version: config.version,
        pathEnv: yield* loginPath,
        launchd,
        homeDir,
      });
      const summary = yield* readTraceSummary({
        traceFile: trace.traceFile,
        maxFiles: trace.traceMaxFiles,
        sinceMs: now - Duration.toMillis(Duration.hours(1)),
      }).pipe(Effect.option);
      const appInstalled =
        process.platform === "darwin" &&
        (yield* fs.exists("/Applications/Xtend.app").pipe(Effect.orElseSucceed(() => false)));
      const traceText =
        summary._tag === "None"
          ? `Could not read ${trace.traceFile}.`
          : summary.value.filesRead.length === 0
            ? `No trace file at ${trace.traceFile}.`
            : // A failure's cause can quote what X or treg said about a post; the agent reads it in the file.
              formatTraceSummary(
                {
                  ...summary.value,
                  recentFailures: summary.value.recentFailures.map((f) => ({ ...f, cause: "" })),
                },
                15,
              );
      const text = `# Xtend triage context

Generated by ${from === "cli" ? "`xtend triage`" : "Settings, Diagnostics"} at ${DateTime.formatIso(DateTime.makeUnsafe(now))}.

- Xtend: ${config.version} (the build that wrote this file; the problem may have happened on another)
- Node: ${process.version}
- OS: ${process.platform} ${process.arch} (${NodeOS.release()})

## Install

- Service: ${health._tag === "Some" ? `xtend ${health.value.version} answers at ${serviceUrl}` : `nothing answers at ${serviceUrl}`}
- Supervised by: ${health._tag === "Some" && health.value.supervisor !== undefined ? SUPERVISORS[health.value.supervisor] : "unknown"}
- launchd agent: ${launchd === undefined ? "not macOS" : !launchd.installed ? "not installed" : launchd.loaded ? "installed and loaded" : "installed, not loaded"}
- Desktop app: ${appInstalled ? "/Applications/Xtend.app" : "not in /Applications"}
- Triage ran from: ${import.meta.url.endsWith(".ts") ? "a source checkout (dev)" : "a packaged build"}

## Paths

- Base dir: ${where.baseDir}
- Database (open it read-only; the service has it open): ${config.dbPath}
- Trace file (NDJSON, rotated to .1 to .${trace.traceMaxFiles}): ${where.traceFile}
- Service log (the service's stdout): ${where.serviceLog}
- Desktop log (the desktop's main process, rotated to .1 to .3): ${where.desktopLog}
- Triage folders: ${where.triageDir}
- Source cache (clone the source here): ${path.join(triageDir, "source")}
- Never read: ${path.join(config.baseDir, "auth-token")}, ~/.treg/config.json, the desktop app's profile (its x-session partition holds X cookies), heap snapshots in the logs dir

## Doctor

\`\`\`
${Doctor.formatChecks(checks)}
\`\`\`

## Trace, last hour

\`\`\`
${traceText}
\`\`\`

## Service process

- ${yield* serviceProcess(config.port)}
`;
      // The same scrubbing as the trace file, in case a path or check ever quotes a credential.
      return redactText(text);
    },
    Effect.provide(platform),
    Effect.orDie,
  );

  const prepare = Effect.fn("Triage.prepare")(function* (from: "cli" | "app") {
    const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
    const dir = path.join(triageDir, stamp);
    const contextFile = path.join(dir, "context.md");
    const playbookFile = path.join(dir, "PLAYBOOK.md");
    const text = yield* context(from);
    yield* Effect.all([
      fs.makeDirectory(dir, { recursive: true }),
      fs.writeFileString(contextFile, text),
      fs.writeFileString(playbookFile, PLAYBOOK),
    ]).pipe(Effect.mapError((cause) => new TriageError({ path: dir, cause })));
    const start = (agent: string) => `cd ${quote(dir)} && ${agent} ${quote(LAUNCH_PROMPT)}`;
    return {
      dir,
      contextFile,
      playbookFile,
      start: { claude: start("claude"), codex: start("codex") },
    };
  });

  return Triage.of({ paths, context, prepare });
});

export const layer = Layer.effect(Triage, make);
