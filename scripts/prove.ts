// Proves a fix with one scenario: it must fail against the base's app and pass against this
// checkout's. The scenario, mock X and fake treg always come from this checkout; only the app under
// test (service, web build, desktop) changes, through XTEND_SCENARIO_APP_DIR. The base is a
// detached worktree next to this one at the merge base, installed from the shared pnpm store.

//   pnpm prove scripts/scenarios/<name>.e2e.ts [--base origin/main] [-t "<test name>"] [--keep]
//   exit 0 proved, 1 not proved (passed on base, or failed here), 2 the base could not be set up
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

export type Outcome = "proved" | "passes on base" | "fails here" | "fails on both";

/** What two runs of one scenario say about a fix. */
export const verdict = (base: boolean, head: boolean): Outcome =>
  base ? (head ? "passes on base" : "fails here") : head ? "proved" : "fails on both";

/** The vitest project a scenario file runs in, or undefined when it is no scenario. */
export const projectOf = (file: string) =>
  /^scripts\/scenarios\/.+\.e2e\.ts$/.test(file)
    ? "e2e"
    : /^scripts\/scenarios\/.+\.engine\.ts$/.test(file)
      ? "engine"
      : undefined;

const root = NodePath.dirname(import.meta.dirname);
const run = (
  cmd: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnSyncOptions,
) => NodeChildProcess.spawnSync(cmd, args, { stdio: "inherit", ...options }).status === 0;
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
  if (project === undefined || !NodeFS.existsSync(NodePath.join(root, file))) {
    console.error(
      "usage: pnpm prove scripts/scenarios/<name>.{e2e,engine}.ts [--base <ref>] [-t <name>]",
    );
    process.exit(2);
  }

  const base = git("merge-base", "HEAD", values.base);
  // Next to this checkout, never in /tmp; one per base commit, so a rerun reuses its install.
  const dir = NodePath.join(
    NodePath.dirname(root),
    `${NodePath.basename(root)}-prove-${base.slice(0, 10)}`,
  );
  const ready =
    NodeFS.existsSync(dir) &&
    NodeChildProcess.spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout.trim() === base;
  if (!ready) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
    git("worktree", "prune");
    git("worktree", "add", "--detach", dir, base);
  }
  const installed =
    ready ||
    (run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: dir }) &&
      // The Electron binary is not in the store; its install script fetches it (from its cache).
      (project !== "engine" ||
        run("pnpm", ["--filter", "@xtend/desktop", "ensure:electron"], { cwd: dir })));
  if (!installed) {
    console.error(`[prove] could not install the base worktree at ${dir}`);
    process.exit(2);
  }

  const scenario = (appDir: string) =>
    run(
      "pnpm",
      [
        "exec",
        "vp",
        "test",
        "run",
        "--project",
        project,
        NodePath.relative("scripts", file),
      ].concat(values.t === undefined ? [] : ["-t", values.t]),
      {
        cwd: NodePath.join(root, "scripts"),
        env: { ...process.env, XTEND_SCENARIO_APP_DIR: appDir },
      },
    );
  console.log(`\n[prove] ${file} against the base's app (${base.slice(0, 10)}, ${values.base})`);
  const onBase = scenario(dir);
  console.log(`\n[prove] ${file} against this checkout's app`);
  const here = scenario(root);
  const outcome = verdict(onBase, here);

  if (!values.keep) {
    git("worktree", "remove", "--force", dir);
  }
  console.log(
    `\n[prove] base ${onBase ? "passed" : "failed"}, here ${here ? "passed" : "failed"}: ${outcome}` +
      (values.keep ? ` (base worktree kept at ${dir})` : ""),
  );
  process.exit(outcome === "proved" ? 0 : 1);
}
