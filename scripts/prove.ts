// Proves a fix with one scenario: its behavior check must fail against the base's app and pass
// against this checkout's. The scenario, mock X and fake treg always come from this checkout; only
// the app under test (service, web build, desktop) changes, through XTEND_SCENARIO_APP_DIR. The base
// is a detached worktree of its own next to this one, at the merge base, removed afterwards.

//   pnpm prove scripts/scenarios/<name>.e2e.ts [--base origin/main] [-t "<test name>"] [--keep]
//   exit 0 proved, 1 not proved (passed on base, or failed here), 2 could not run on one side
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

/** The parts of vitest's JSON report a verdict reads. */
export interface RunReport {
  readonly numTotalTests: number;
  readonly numFailedTests: number;
  readonly numPassedTests: number;
  readonly testResults: ReadonlyArray<{ readonly message: string }>;
}

/**
 * A run "failed" only when a test ran and its check failed: an assertion, or a wait for the page
 * that never came true, which is how a missing button shows. A file-level error (a hook, so the app
 * never started), no report (setup or the build broke) or a pass with an unhandled error that still
 * failed the run is "broken": it proves nothing.
 */
export const resultOf = (report: RunReport | undefined, exitedClean: boolean) =>
  report === undefined ||
  report.numTotalTests === 0 ||
  report.testResults.some((file) => file.message !== "")
    ? "broken"
    : report.numFailedTests > 0
      ? "failed"
      : report.numPassedTests > 0 && exitedClean
        ? "passed"
        : "broken";

/** Exit 0 only for a check that failed on the base and passes here. */
export const exitCodeOf = (base: ReturnType<typeof resultOf>, here: ReturnType<typeof resultOf>) =>
  base === "broken" || here === "broken" ? 2 : base === "failed" && here === "passed" ? 0 : 1;

/** The vitest project a scenario file runs in, or undefined when it is no scenario. */
export const projectOf = (file: string) =>
  /^scripts\/scenarios\/.+\.e2e\.ts$/.test(file)
    ? "e2e"
    : /^scripts\/scenarios\/.+\.engine\.ts$/.test(file)
      ? "engine"
      : undefined;

const root = NodePath.dirname(import.meta.dirname);
// Ctrl-C reaches the child and ends it; this process, blocked in spawnSync, sees it only there.
let interrupted = () => process.exit(130);
const run = (
  cmd: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnSyncOptions,
) => {
  const result = NodeChildProcess.spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.signal === "SIGINT" || result.status === 130) interrupted();
  return result.status === 0;
};
const git = (...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

if (import.meta.main) {
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      base: { type: "string", default: "origin/main" },
      t: { type: "string", short: "t" },
      keep: { type: "boolean", default: false },
    },
  });
  const file = NodePath.relative(root, NodePath.resolve(positionals[0] ?? ""));
  const project = projectOf(file);
  const fail = (message: string): never => {
    console.error(`[prove] ${message}`);
    process.exit(2);
  };
  if (project === undefined || !NodeFS.existsSync(NodePath.join(root, file)))
    fail("usage: pnpm prove scripts/scenarios/<name>.{e2e,engine}.ts [--base <ref>] [-t <name>]");

  const base = git("merge-base", "HEAD", values.base);
  // A desktop from before mock X had its own profile would open the real x.com; the engine harness
  // refuses it too, this only says so before an install.
  if (
    project === "engine" &&
    !NodeChildProcess.spawnSync("git", ["show", `${base}:apps/desktop/src/main.ts`], {
      cwd: root,
      encoding: "utf8",
    }).stdout.includes("xtend-mock-x-")
  )
    fail(
      `the base ${base.slice(0, 10)} predates mock X's own profile: it would open the real x.com`,
    );

  // Its own worktree per run, next to this checkout and never in /tmp: concurrent proofs never
  // share or remove each other's.
  const dir = NodePath.join(
    NodePath.dirname(root),
    `${NodePath.basename(root)}-prove-${base.slice(0, 10)}-${process.pid}`,
  );
  if (NodeFS.existsSync(dir)) fail(`${dir} already exists; remove it first`);
  git("worktree", "add", "--detach", dir, base);
  const cleanup = () => {
    if (!values.keep) git("worktree", "remove", "--force", dir);
  };
  interrupted = () => {
    cleanup();
    process.exit(130);
  };
  const installed =
    run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir }) &&
    // The Electron binary is not in the store; its install script fetches it (from its cache).
    (project !== "engine" ||
      run("pnpm", ["--filter", "@xtend/desktop", "ensure:electron"], { cwd: dir }));
  if (!installed) {
    cleanup();
    fail(`could not install the base worktree at ${dir}`);
  }

  const reportFile = NodePath.join(NodeOS.tmpdir(), `xtend-prove-${process.pid}.json`);
  const scenario = (appDir: string) => {
    NodeFS.rmSync(reportFile, { force: true });
    const exitedClean = run(
      "pnpm",
      ["exec", "vp", "test", "run", "--project", project!, NodePath.relative("scripts", file)]
        .concat(values.t === undefined ? [] : ["-t", values.t])
        .concat(["--reporter=default", "--reporter=json", `--outputFile.json=${reportFile}`]),
      {
        cwd: NodePath.join(root, "scripts"),
        env: { ...process.env, XTEND_SCENARIO_APP_DIR: appDir },
      },
    );
    const report = NodeFS.existsSync(reportFile)
      ? (JSON.parse(NodeFS.readFileSync(reportFile, "utf8")) as RunReport)
      : undefined;
    NodeFS.rmSync(reportFile, { force: true });
    return resultOf(report, exitedClean);
  };
  console.log(`\n[prove] ${file} against the base's app (${base.slice(0, 10)}, ${values.base})`);
  const onBase = scenario(dir);
  console.log(`\n[prove] ${file} against this checkout's app`);
  const here = scenario(root);
  cleanup();

  const code = exitCodeOf(onBase, here);
  console.log(
    `\n[prove] base ${onBase}, here ${here}: ` +
      ["proved", "not proved", "could not run (a broken run proves nothing)"][code] +
      (values.keep ? ` (base worktree kept at ${dir})` : ""),
  );
  process.exit(code);
}
