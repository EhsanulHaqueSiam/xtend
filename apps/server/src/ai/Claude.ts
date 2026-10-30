import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/** A structured call ends well inside this; a hung CLI must not hold a screen's button forever. */
const TIMEOUT = Duration.minutes(3);

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** What `claude -p --output-format json` prints: one result, or every message with a result last. */
const Result = Schema.Struct({
  type: Schema.String,
  is_error: Schema.optionalKey(Schema.Boolean),
  result: Schema.optionalKey(Schema.String),
  structured_output: Schema.optionalKey(Schema.Unknown),
});
const decodeOutput = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Union([Result, Schema.Array(Result)])),
);

/**
 * Claude refuses `--strict-mcp-config` beside a managed MCP config, which already keeps the
 * user's own servers out. Same paths Claude Code checks.
 */
const MANAGED_MCP =
  process.platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
    : process.platform === "win32"
      ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
      : "/etc/claude-code/managed-mcp.json";

/**
 * The arguments for one structured answer from the Claude CLI, the way T3 Code's text generation
 * drives it: print mode, the answer's shape from a schema, no tools, no MCP servers, hooks,
 * commands or saved session; the prompt goes on stdin. An empty model leaves the CLI's default.
 */
const claudeArgs = (input: {
  readonly model: string;
  readonly system: string;
  readonly jsonSchema: unknown;
  readonly managedMcp: boolean;
}) => [
  "-p",
  "--output-format",
  "json",
  "--json-schema",
  encodeJson(input.jsonSchema),
  "--system-prompt",
  input.system,
  ...(input.model === "" ? [] : ["--model", input.model]),
  "--tools",
  "",
  "--settings",
  encodeJson({ disableAllHooks: true }),
  "--disable-slash-commands",
  ...(input.managedMcp ? [] : ["--strict-mcp-config"]),
  "--no-session-persistence",
  "--permission-mode",
  "dontAsk",
];

/**
 * One structured answer through the Claude login on the service machine. `binary` is the user's
 * command for it (a wrapper that picks an account works); PATH is the login shell's.
 * Fails with a short reason the screen can show.
 */
export const complete = Effect.fn("Claude.complete")(function* (input: {
  readonly binary: string;
  readonly path: string;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: unknown;
}) {
  const fs = yield* FileSystem.FileSystem;
  const managedMcp = yield* fs.exists(MANAGED_MCP).pipe(Effect.orElseSucceed(() => false));
  return yield* Effect.gen(function* () {
    // An empty directory, so no project's CLAUDE.md or settings shape the answer.
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "xtend-claude-" });
    const claude = yield* ChildProcess.make(input.binary, claudeArgs({ ...input, managedMcp }), {
      cwd,
      // Electron's flag would turn a Claude that is itself Electron-hosted into plain Node.
      env: { ...process.env, PATH: input.path, ELECTRON_RUN_AS_NODE: undefined },
      stdin: Stream.make(new TextEncoder().encode(input.prompt)),
    });
    const [code, stdout, stderr] = yield* Effect.all(
      [
        claude.exitCode,
        claude.stdout.pipe(Stream.decodeText(), Stream.mkString),
        claude.stderr.pipe(Stream.decodeText(), Stream.mkString),
      ],
      { concurrency: "unbounded" },
    );
    const output = yield* decodeOutput(stdout).pipe(Effect.orElseSucceed(() => null));
    const result = [output].flat().findLast((m) => m?.type === "result");
    if (result?.is_error === true || code !== 0 || result == null)
      return yield* Effect.fail(
        result?.result?.trim() || stderr.trim().split("\n").at(-1) || `claude exited with ${code}`,
      );
    return result.structured_output;
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: TIMEOUT,
      orElse: () => Effect.fail("Claude took longer than three minutes."),
    }),
    Effect.mapError((e) =>
      typeof e === "string"
        ? e
        : String(e).includes("NotFound")
          ? `${input.binary} was not found on the machine running Xtend's service. Set its path in Settings, Writing.`
          : String(e).slice(0, 300),
    ),
  );
});
