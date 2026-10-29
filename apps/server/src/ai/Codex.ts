import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

/** A structured call ends well inside this; a hung CLI must not hold a screen's button forever. */
const TIMEOUT = Duration.minutes(3);

const JsonText = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeSync(JsonText);
const decodeJson = Schema.decodeUnknownEffect(JsonText);

/**
 * The arguments for one structured answer from the Codex CLI, the way T3 Code drives it: no repo,
 * nothing kept, a read-only sandbox, the prompt on stdin, the answer's shape from a schema file
 * and the final message written to a file. An empty model leaves the user's Codex config in charge.
 */
export const codexArgs = (input: {
  readonly model: string;
  readonly schemaPath: string;
  readonly outPath: string;
}) => [
  "exec",
  "--skip-git-repo-check",
  "--ephemeral",
  "--sandbox",
  "read-only",
  "--output-schema",
  input.schemaPath,
  "--output-last-message",
  input.outPath,
  "-c",
  "mcp_servers={}",
  ...(input.model === "" ? [] : ["--model", input.model]),
  "-",
];

/**
 * The schema as OpenAI's strict mode accepts it: every object closed and every property listed
 * as required. Effect's JSON Schema leaves `additionalProperties` out.
 */
export const strictSchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (typeof node !== "object" || node === null) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, strictSchema(v)]));
  if (typeof out.properties === "object" && out.properties !== null) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
};

/**
 * The user's Codex config reduced to what a model call needs: the model keys at the top and the
 * model provider sections. An allowlist, so MCP servers, hooks and anything new never come
 * along; the prompt carries text from strangers' posts.
 */
export const isolatedConfig = (toml: string) => {
  let inProvider = false;
  let top = true;
  return toml
    .split("\n")
    .filter((line) => {
      const header = /^\s*\[+\s*([^\]]*?)\s*\]+/.exec(line);
      if (header !== null) {
        top = false;
        inProvider = /^model_providers(\.|$)/.test(header[1]!);
        return inProvider;
      }
      if (top) return /^\s*(model|model_provider|model_reasoning_effort)\s*=/.test(line);
      return inProvider;
    })
    .join("\n");
};

/**
 * One structured answer through the Codex login on the service machine (ChatGPT or its own key).
 * Fails with a short reason the screen can show.
 * shortcut: strict mode makes every field required, so an optional field in an assist output
 * schema always comes back; give such outputs explicit nulls if one ever needs to be absent.
 */
export const complete = Effect.fn("Codex.complete")(function* (input: {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: unknown;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.gen(function* () {
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "xtend-codex-" });
    const schemaPath = path.join(dir, "schema.json");
    const outPath = path.join(dir, "answer.json");
    yield* fs.writeFileString(schemaPath, encodeJson(strictSchema(input.jsonSchema)));
    // A home of its own with only the login and the stripped config, so nothing from the user's
    // Codex setup (MCP servers, hooks) is reachable from a run that reads strangers' text.
    // shortcut: the read-only sandbox still allows commands that read files; drop it when Codex
    // exposes a switch for the shell tool.
    const userHome = process.env.CODEX_HOME ?? path.join(process.env.HOME ?? ".", ".codex");
    const home = path.join(dir, "home");
    yield* fs.makeDirectory(home);
    yield* fs.copyFile(path.join(userHome, "auth.json"), path.join(home, "auth.json"));
    const config = yield* fs
      .readFileString(path.join(userHome, "config.toml"))
      .pipe(Effect.orElseSucceed(() => ""));
    yield* fs.writeFileString(path.join(home, "config.toml"), isolatedConfig(config));
    const codex = yield* ChildProcess.make("codex", codexArgs({ ...input, schemaPath, outPath }), {
      cwd: dir,
      // Only what the CLI needs to find itself and its login; the service's own secrets stay out.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: home },
      stdin: Stream.make(new TextEncoder().encode(`${input.system}\n\n${input.prompt}`)),
      stdout: "ignore",
    });
    const [code, stderr] = yield* Effect.all(
      [codex.exitCode, codex.stderr.pipe(Stream.decodeText(), Stream.mkString)],
      { concurrency: 2 },
    );
    if (code !== 0)
      return yield* Effect.fail(stderr.trim().split("\n").at(-1) || `codex exited with ${code}`);
    return yield* decodeJson(yield* fs.readFileString(outPath));
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: TIMEOUT,
      orElse: () => Effect.fail("Codex took longer than three minutes."),
    }),
    Effect.mapError((e) =>
      typeof e === "string"
        ? e
        : String(e).includes("ENOENT")
          ? "Codex is not installed or not logged in on the machine running Xtend's service."
          : String(e).slice(0, 300),
    ),
  );
});
