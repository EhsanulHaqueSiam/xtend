// @effect-diagnostics nodeBuiltinImport:off -- a desktop child watches its raw stdin pipe.
import * as NodeStream from "node:stream";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type AgentRun,
  Compose_METHODS,
  type Draft,
  type DraftList,
  Leads_METHODS,
  PortSchema,
  Scores_METHODS,
  type ServiceSupervisor,
  type SignalAgent,
  type SpendSummary,
  WS_METHODS,
} from "@xtend/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import * as Api from "./cli/api.ts";
import * as Doctor from "./cli/doctor.ts";
import * as Trace from "./cli/trace.ts";
import { runMcpStdio } from "./cli/mcp.ts";
import { loginPath } from "./ai/loginPath.ts";
import * as ServerConfig from "./config.ts";
import { runServer } from "./server.ts";
import * as Launchd from "./service/launchd.ts";
import { RATE_CARD } from "./x/XClient.ts";

const portFlag = Flag.Int("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.String("host").pipe(
  Flag.withDescription("Interface to bind. Loopback by default; a Tailnet IP to share it."),
  Flag.optional,
);
const baseDirFlag = Flag.String("base-dir").pipe(
  Flag.withDescription("Data directory. Defaults to ~/.xtend (XTEND_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.String("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Vite dev server to redirect the web UI to instead of serving dist."),
  Flag.optional,
);

// Shared so `xtend --base-dir X post ...` and `xtend post --base-dir X ...` both reach the same service.
const root = Command.make("xtend").pipe(
  Command.withSharedFlags({
    port: portFlag,
    host: hostFlag,
    baseDir: baseDirFlag,
    devUrl: devUrlFlag,
  }),
);
type RootFlags = Effect.Success<typeof root>;

const resolveConfig = (flags: RootFlags) =>
  ServerConfig.resolve({
    port: Option.getOrUndefined(flags.port),
    host: Option.getOrUndefined(flags.host),
    baseDir: Option.getOrUndefined(flags.baseDir),
    devUrl: Option.getOrUndefined(flags.devUrl),
  });

/**
 * Subcommands talk to the running service over its HTTP API. An Api already in
 * context (tests) wins; otherwise the token comes from the base dir and the URL
 * from XTEND_SERVICE_URL or the port flag.
 */
const withApi = Effect.fn("binCli.withApi")(function* <A, E>(effect: Effect.Effect<A, E, Api.Api>) {
  const given = yield* Effect.serviceOption(Api.Api);
  if (Option.isSome(given)) return yield* Effect.provideService(effect, Api.Api, given.value);
  const config = yield* resolveConfig(yield* root);
  const token = yield* Api.readToken(config.baseDir);
  const url = process.env.XTEND_SERVICE_URL ?? `http://127.0.0.1:${config.port}`;
  return yield* effect.pipe(
    Effect.provide(Api.layer({ url, token }).pipe(Layer.provide(NodeHttpClient.layerNodeHttp))),
  );
});

const call = <A>(method: string, payload: unknown) =>
  Effect.flatMap(Api.Api, (api) => api.call(method, payload)).pipe(Effect.map((r) => r as A));

const firstLine = (draft: Draft) => draft.blocks[0]?.text.split("\n")[0] ?? draft.title;

const post = Command.make("post", { text: Argument.String("text") }).pipe(
  Command.withDescription(
    `Post one text right now through the X API (costs $${RATE_CARD.post.toFixed(3)}, $${RATE_CARD.postWithLink.toFixed(2)} with a link).`,
  ),
  Command.withHandler(({ text }) =>
    withApi(
      Effect.gen(function* () {
        const draft = yield* call<Draft>(Compose_METHODS.draftCreate, { blocks: [{ text }] });
        const posted = yield* call<Draft>(Compose_METHODS.postNow, { id: draft.id });
        // A post that did not go out fails the command, so `xtend post ... && next` stops.
        if (posted.status !== "posted")
          return yield* new Api.ApiError({
            detail: `${posted.status}: ${posted.error ?? "no detail"}`,
          });
        yield* Console.log(`posted https://x.com/i/status/${posted.postIds[0]}`);
      }),
    ),
  ),
);

const queue = Command.make("queue").pipe(
  Command.withDescription("Drafts waiting in the queue."),
  Command.withHandler(() =>
    withApi(
      Effect.gen(function* () {
        const { drafts } = yield* call<DraftList>(Compose_METHODS.draftsList, {});
        const queued = drafts.filter((d) => d.status === "queued");
        if (queued.length === 0) return yield* Console.log("queue is empty");
        for (const d of queued)
          yield* Console.log(`${d.scheduledAt ?? "unscheduled"}  ${d.id}  ${firstLine(d)}`);
      }),
    ),
  ),
);

const report = Command.make("report", { handle: Argument.String("handle") }).pipe(
  Command.withDescription("Score report for a handle, as JSON."),
  Command.withHandler(({ handle }) =>
    withApi(
      Effect.flatMap(
        call<unknown>(Scores_METHODS.report, { handle: handle.replace(/^@/, "") }),
        (r) => Console.log(JSON.stringify(r, null, 2)),
      ),
    ),
  ),
);

const spend = Command.make("spend").pipe(
  Command.withDescription("This month's spend against the budget."),
  Command.withHandler(() =>
    withApi(
      Effect.flatMap(call<SpendSummary>(WS_METHODS.spendSummary, {}), (s) =>
        Console.log(
          `month $${s.monthUsd.toFixed(2)} of $${s.monthlyBudgetUsd.toFixed(2)}, today $${s.todayUsd.toFixed(2)}`,
        ),
      ),
    ),
  ),
);

const agentsRun = Command.make("run", { name: Argument.String("name") }).pipe(
  Command.withDescription(
    `Run a signal agent by name. Paid: one search ($${RATE_CARD.searchPage}), a profile read ($${RATE_CARD.scraperProfile}) per new author when it drops bots, and one model call to score them.`,
  ),
  Command.withHandler(({ name }) =>
    withApi(
      Effect.gen(function* () {
        const agents = yield* call<ReadonlyArray<SignalAgent>>(Leads_METHODS.agentsList, {});
        const agent = agents.find((a) => a.name === name);
        if (agent === undefined)
          return yield* new Api.ApiError({ detail: `no agent named ${name}` });
        const run = yield* call<AgentRun>(Leads_METHODS.agentRun, { id: agent.id });
        if (run.error !== null) return yield* new Api.ApiError({ detail: `failed: ${run.error}` });
        yield* Console.log(
          `found ${run.found}, new ${run.inserted}, cost $${run.costUsd.toFixed(3)}`,
        );
      }),
    ),
  ),
);
const agents = Command.make("agents").pipe(
  Command.withDescription("Signal agents."),
  Command.withSubcommands([agentsRun]),
);

const mcp = Command.make("mcp").pipe(
  Command.withDescription("Serve the Model Context Protocol over stdio for agents."),
  Command.withHandler(() =>
    withApi(
      Effect.flatMap(Api.Api, (api) =>
        Effect.promise(() =>
          runMcpStdio(process.stdin, process.stdout, (method, payload) =>
            Effect.runPromise(api.call(method, payload)),
          ),
        ),
      ),
    ),
  ),
);

const serviceInstall = Command.make("install").pipe(
  Command.withDescription(
    "Install a launchd agent that keeps the service running with the app closed.",
  ),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const flags = yield* root;
      const config = yield* resolveConfig(flags);
      const file = Launchd.install({
        baseDir: config.baseDir,
        port: config.port,
        host: Option.getOrUndefined(flags.host),
      });
      yield* Console.log(`installed ${file}`);
    }),
  ),
);
const serviceUninstall = Command.make("uninstall").pipe(
  Command.withDescription("Stop and remove the launchd agent."),
  Command.withHandler(() => Console.log(Launchd.uninstall() ? "removed" : "nothing installed")),
);
const serviceStatus = Command.make("status").pipe(
  Command.withDescription("Whether the launchd agent is installed and loaded."),
  Command.withHandler(() => {
    const s = Launchd.status();
    return Console.log(`installed: ${s.installed}\nloaded: ${s.loaded}`);
  }),
);
const service = Command.make("service").pipe(
  Command.withDescription("launchd supervision of the service."),
  Command.withSubcommands([serviceInstall, serviceUninstall, serviceStatus]),
);

const trace = Command.make("trace", {
  since: Flag.String("since").pipe(
    Flag.filterMap(Trace.parseSince, (text) => `not a duration: ${text} (try 30m, 2h, 7d)`),
    Flag.withDescription("Only spans that ended in this window, like 30m, 2h or 7d."),
    Flag.optional,
  ),
  limit: Flag.Int("limit").pipe(
    Flag.withDescription("Span names to show, busiest first."),
    Flag.withDefault(25),
  ),
}).pipe(
  Command.withDescription(
    "Summarize the service's trace file: count, p50, p95, max and failures per span, then the latest failures.",
  ),
  Command.withHandler(({ since, limit }) =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(yield* root);
      yield* Console.log(yield* Trace.traceReport({ baseDir: config.baseDir, since, limit }));
    }),
  ),
);

const doctor = Command.make("doctor").pipe(
  Command.withDescription(
    "Check the base dir, database, service, trace file, treg token, assist CLI and launchd. Read-only.",
  ),
  Command.withHandler(() =>
    Effect.gen(function* () {
      const config = yield* resolveConfig(yield* root);
      const checks = yield* Doctor.runDoctor({
        baseDir: config.baseDir,
        dbPath: config.dbPath,
        serviceUrl: process.env.XTEND_SERVICE_URL ?? `http://127.0.0.1:${config.port}`,
        version: config.version,
        pathEnv: yield* loginPath,
        launchd: process.platform === "darwin" ? Launchd.status() : undefined,
        homeDir: process.env.HOME ?? process.env.USERPROFILE ?? ".",
      }).pipe(Effect.provide(NodeHttpClient.layerNodeHttp));
      yield* Console.log(Doctor.formatChecks(checks));
      // A failed check is already printed; the exit code is for scripts.
      if (checks.some((c) => !c.ok)) yield* Effect.sync(() => (process.exitCode = 1));
    }),
  ),
);

/**
 * A desktop's child stops with the desktop. An Electron that crashed sends no SIGTERM, but the OS
 * closes its end of the child's stdin pipe. launchd and a shell give stdin no such meaning, so
 * only a child watches it.
 */
export const stopWithDesktop =
  (supervisor: ServiceSupervisor, stdin: NodeJS.ReadableStream) =>
  <A, E, R>(server: Effect.Effect<A, E, R>) =>
    supervisor !== "child"
      ? server
      : Effect.raceFirst(
          server,
          Effect.callback<void>((resume) => {
            const forget = NodeStream.finished(stdin, () =>
              resume(Effect.logInfo("the desktop that started this service is gone; stopping")),
            );
            stdin.resume();
            return Effect.sync(forget);
          }),
        );

export const cli = root.pipe(
  Command.withDescription("Run the Xtend service, or drive a running one."),
  Command.withHandler((flags) =>
    Effect.flatMap(resolveConfig(flags), (config) =>
      runServer.pipe(
        stopWithDesktop(config.supervisor, process.stdin),
        Effect.provide(ServerConfig.layer(config)),
      ),
    ),
  ),
  Command.withSubcommands([post, queue, report, spend, agents, mcp, service, trace, doctor]),
);

export function runCli() {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
