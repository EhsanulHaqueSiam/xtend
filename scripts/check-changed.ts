// The fast local version of CI for this branch's changes: the lockfile and patches, format and
// lint of the changed files, knip, typecheck of the packages they reach (per ci-changes.cjs, as
// CI gates) and the tests beside the changed files. Steps run side by side within a budget, each
// printing its output as it finishes; a rerun on exactly the last passing input prints its summary.

//   pnpm check:changed                  against the closest merge base with any remote's main
//   pnpm check:changed <ref>            against the merge base with <ref>
//   pnpm check:changed --concurrency 1  one step at a time (CHECK_CHANGED_CONCURRENCY)
//   pnpm check:changed --timeout 600    seconds before a step is killed (CHECK_CHANGED_TIMEOUT)
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { decide, readWorkspace } from "../.github/scripts/ci-changes.cjs";

const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const GiB = 1024 ** 3;

/** A typecheck or test step can take several cores and gigabytes: one per two cores and per 6 GiB. */
export const defaultConcurrency = (cores: number, availableBytes: number) =>
  Math.max(1, Math.min(Math.floor(cores / 2), Math.floor(availableBytes / (6 * GiB))));

/** The candidate the fewest commits behind HEAD; undefined when no remote's main shares history. */
export const closestBase = <
  A extends { readonly base: string | undefined; readonly ahead: number },
>(
  candidates: ReadonlyArray<A>,
) =>
  candidates
    .filter((c) => c.base !== undefined)
    .reduce<A | undefined>(
      (best, c) => (best === undefined || c.ahead < best.ahead ? c : best),
      undefined,
    );

/** One step: a pnpm command in `cwd` (relative to the root), or the lockfile and patch check. */
export type Plan =
  | {
      readonly name: string;
      readonly kind: "pnpm";
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly weight?: number;
      readonly serial?: boolean;
    }
  | { readonly name: string; readonly kind: "patches" };

const isDependencyFile = (file: string) =>
  file === "pnpm-workspace.yaml" ||
  file === "pnpm-lock.yaml" ||
  file.startsWith("patches/") ||
  NodePath.posix.basename(file) === "package.json";

/**
 * The steps a change needs. `changed` is every changed path, deleted ones included (they still
 * count for typecheck and knip); `present` the ones on disk; `beside(dir)` lists a directory.
 */
export function planSteps(input: {
  readonly changed: ReadonlyArray<string>;
  readonly present: ReadonlyArray<string>;
  readonly packages: ReadonlyArray<{ readonly dir: string; readonly name: string }>;
  readonly beside: (dir: string) => ReadonlyArray<string>;
  readonly concurrency: number;
}) {
  const { changed, present, packages } = input;
  const { affected, outputs } = decide([...changed], [...packages]);
  const code = present.filter((file) => CODE.test(file));

  // Changed test files and the ones beside a changed source file (foo.ts -> foo.test.ts, foo.browser.test.tsx).
  const tests = new Set(code.filter((file) => TEST.test(file)));
  for (const file of code) {
    const dir = NodePath.posix.dirname(file);
    const prefix = `${NodePath.posix.basename(file).replace(CODE, "")}.`;
    for (const entry of input.beside(dir))
      if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.posix.join(dir, entry));
  }
  // The WebSocket payload budgets sit beside no source file they guard.
  if (affected.includes("xtend")) tests.add("apps/server/src/payloads.test.ts");

  const steps: Array<Plan> = [];
  const pnpm = (
    name: string,
    args: ReadonlyArray<string>,
    extra: { readonly cwd?: string; readonly weight?: number; readonly serial?: boolean } = {},
  ) => steps.push({ name, kind: "pnpm", args, ...extra, cwd: extra.cwd ?? "." });

  if (changed.some(isDependencyFile)) steps.push({ name: "lockfile and patches", kind: "patches" });
  // No files would make fmt check the whole repo.
  if (present.length > 0)
    pnpm("format", ["exec", "vp", "fmt", "--check", "--no-error-on-unmatched-pattern", ...present]);
  // A rule or config change can flag files this branch never touched, so it lints everything.
  const lint = ["exec", "vp", "lint", "--deny-warnings", "--report-unused-disable-directives"];
  if (changed.some((f) => f === "vite.config.ts" || f.startsWith("packages/oxlint-plugin/")))
    pnpm("lint (rules changed: every file)", lint);
  else if (code.length > 0) pnpm("lint", [...lint, ...code]);
  if (
    changed.some(
      (f) => CODE.test(f) || NodePath.posix.basename(f) === "package.json" || f === "knip.jsonc",
    )
  )
    pnpm("knip", ["exec", "knip"]);
  if (affected.length > 0) {
    // tsc writes nothing another package reads, so dependency order would only make dependents wait.
    const workers = Math.min(input.concurrency, affected.length);
    pnpm(
      `typecheck (${affected.length} packages)`,
      [
        "exec",
        "vp",
        "run",
        "--cache",
        "--parallel",
        "--concurrency-limit",
        String(workers),
        ...affected.flatMap((name) => ["--filter", name]),
        "typecheck",
      ],
      { weight: workers },
    );
  }
  // Root scripts belong to no package, and they import from several, so any of those changes too.
  if (affected.length > 0 || changed.some((f) => f.startsWith("scripts/")))
    pnpm("typecheck scripts", ["run", "typecheck:scripts"]);
  // .github/scripts tests run under node --test, as in `pnpm test`.
  const githubTests = [...tests].filter((file) => file.startsWith(".github/"));
  if (githubTests.length > 0)
    pnpm("test .github/scripts", ["exec", "node", "--test", ...githubTests]);
  // Vitest runs started together race on node_modules/.vitest-cache, so test steps go one at a time.
  const rootTests = [...tests].filter((file) => file.startsWith("scripts/"));
  if (rootTests.length > 0)
    pnpm("test scripts", ["exec", "vp", "test", "run", ...rootTests], { serial: true });
  for (const p of packages) {
    const own = [...tests]
      .filter((file) => file.startsWith(`${p.dir}/`))
      .map((file) => file.slice(p.dir.length + 1));
    if (own.length > 0)
      pnpm(`test ${p.name}`, ["exec", "vp", "test", "run", ...own], { cwd: p.dir, serial: true });
  }

  const ciAlso = [
    ...(outputs.test ? ["full test suites", "e2e journeys"] : []),
    ...(outputs.build ? ["build", "desktop smoke"] : []),
  ];
  return { steps, tests: [...tests], ciAlso };
}

/** What a passing run's result depends on; a rerun with the same key has nothing new to check. */
export const cacheKey = (parts: ReadonlyArray<string | Uint8Array>) => {
  const hash = NodeCrypto.createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

interface Result {
  readonly ok: boolean;
  readonly output: string;
  readonly timedOut?: boolean;
}

/** Runs pnpm in its own process group, so a timeout kills everything it started. */
const runPnpm = (cwd: string, args: ReadonlyArray<string>, timeoutSeconds: number) =>
  new Promise<Result>((resolve) => {
    const child = NodeChildProcess.spawn("pnpm", [...args], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Output is piped, so keep the colors a terminal would get.
      env: process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env,
    });
    const chunks: Array<Buffer> = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    let timedOut = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // The group already exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    }, timeoutSeconds * 1000);
    child.on("error", (error) => chunks.push(Buffer.from(String(error))));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, output: Buffer.concat(chunks).toString(), timedOut });
    });
  });

/**
 * The install CI runs, in a temp copy so the working tree and lockfile stay as they are: a lockfile
 * that no longer matches the manifests, or a patch a version bump left unused, fails here too.
 */
const checkPatches = async (
  root: string,
  packages: ReadonlyArray<{ readonly dir: string }>,
  timeoutSeconds: number,
) => {
  const temp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-patch-check-"));
  try {
    const files = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "patches"];
    for (const file of [...files, ...packages.map((p) => `${p.dir}/package.json`)]) {
      if (!NodeFS.existsSync(NodePath.join(root, file))) continue;
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(temp, file)), { recursive: true });
      NodeFS.cpSync(NodePath.join(root, file), NodePath.join(temp, file), { recursive: true });
    }
    const result = await runPnpm(
      temp,
      ["install", "--lockfile-only", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"],
      timeoutSeconds,
    );
    return result.ok || !result.output.includes("ERR_PNPM_UNUSED_PATCH")
      ? result
      : {
          ...result,
          output: `${result.output}\nUnused patches: remove each one named above from patchedDependencies in pnpm-workspace.yaml and patches/, or update it to the version the install resolves.`,
        };
  } finally {
    NodeFS.rmSync(temp, { recursive: true, force: true });
  }
};

/**
 * Runs `steps` side by side, admitting them in order so a heavy step is not starved by later light
 * ones; a step holds `weight` slots of the budget, and serial steps wait for each other.
 */
async function runSteps<
  S extends { readonly name: string; readonly weight?: number; readonly serial?: boolean },
>(steps: ReadonlyArray<S>, concurrency: number, run: (step: S) => Promise<Result>) {
  let free = concurrency;
  const waiting: Array<() => void> = [];
  // Woken by every release, it tries again until enough slots are free.
  const acquire = (n: number): Promise<void> => {
    if (free >= n) {
      free -= n;
      return Promise.resolve();
    }
    return new Promise<void>((wake) => waiting.push(wake)).then(() => acquire(n));
  };
  const release = (n: number) => {
    free += n;
    for (const wake of waiting.splice(0)) wake();
  };
  let serialDone = Promise.resolve();
  const running: Array<Promise<{ name: string; outcome: string; time: string }>> = [];
  for (const step of steps) {
    const slots = Math.min(step.weight ?? 1, concurrency);
    if (step.serial) await serialDone;
    await acquire(slots);
    const started = Date.now();
    const done = run(step).then((result) => {
      release(slots);
      const outcome = result.timedOut ? "TIMEOUT" : result.ok ? "pass" : "FAIL";
      const time = `${((Date.now() - started) / 1000).toFixed(1)}s`;
      console.log(`\n> ${step.name}  ${outcome}  ${time}`);
      if (result.output.trim() !== "") console.log(result.output.trimEnd());
      return { name: step.name, outcome, time };
    });
    if (step.serial) serialDone = done.then(() => undefined);
    running.push(done);
  }
  return Promise.all(running);
}

const positive = (name: string, value: string | undefined) => {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(`check:changed: ${name} must be a positive integer.`);
  return Number(value);
};

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: { concurrency: { type: "string" }, timeout: { type: "string" } },
  });
  // macOS counts its file cache as used memory, so total memory stands in for available there.
  const concurrency =
    positive("--concurrency", values.concurrency ?? process.env.CHECK_CHANGED_CONCURRENCY) ??
    defaultConcurrency(
      NodeOS.availableParallelism(),
      process.platform === "darwin" ? NodeOS.totalmem() : process.availableMemory(),
    );
  const timeoutSeconds =
    positive("--timeout", values.timeout ?? process.env.CHECK_CHANGED_TIMEOUT) ?? 900;

  // Fails on a nonzero exit: an empty file list from a broken index would pass as "no changes".
  // quotePath=false keeps non-ASCII paths as paths.
  const git = (...args: ReadonlyArray<string>) => {
    const result = NodeChildProcess.spawnSync("git", ["-c", "core.quotePath=false", ...args], {
      cwd: root,
      maxBuffer: 512 * 1024 * 1024,
    });
    if (result.status !== 0) {
      console.error(
        `check:changed: git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
      );
      process.exit(1);
    }
    return result.stdout;
  };
  const lines = (...args: ReadonlyArray<string>) =>
    git(...args)
      .toString()
      .split("\n")
      .filter(Boolean);
  const tryBase = (rev: string) => {
    const result = NodeChildProcess.spawnSync("git", ["merge-base", "HEAD", rev], {
      cwd: root,
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };

  const refs = positionals[0] === undefined ? lines("remote").map((r) => `${r}/main`) : positionals;
  const candidates = refs.map((ref) => {
    const base = tryBase(ref);
    const ahead =
      base === undefined
        ? Infinity
        : Number(git("rev-list", "--count", `${base}..HEAD`).toString());
    return { ref, base, ahead };
  });
  const chosen = closestBase(candidates);
  if (chosen?.base === undefined) {
    const tried = candidates.map((c) => c.ref).join(", ") || "a remote's main";
    console.error(`check:changed: no merge base with ${tried}. Run git fetch or pass a ref.`);
    process.exit(1);
  }
  const base = chosen.base;

  // --no-renames lists a rename as its old and new path, as CI does.
  const tracked = lines("diff", "--name-only", "--no-renames", base, "--");
  const untracked = lines("ls-files", "--others", "--exclude-standard");
  const changed = [...new Set([...tracked, ...untracked])].sort();
  if (changed.length === 0) {
    console.log(`check:changed: no changes since ${base.slice(0, 12)} (${chosen.ref}).`);
    process.exit(0);
  }
  console.log(
    `check:changed: ${changed.length} files since ${base.slice(0, 12)} (${chosen.ref}), ${concurrency} at a time`,
  );

  // Recomputed after a pass, so edits made during the run are never cached as passing.
  const inputKey = () =>
    cacheKey([
      process.version,
      base,
      // CI changes behavior (the test config rejects .only under CI).
      process.env.CI ?? "",
      git("diff", "--binary", "--no-renames", "--no-ext-diff", "--no-textconv", base, "--"),
      // Raw bytes too: the formatter reads the file on disk, not git's normalized diff.
      ...[...changed, "node_modules/.modules.yaml", "node_modules/.pnpm/lock.yaml"].flatMap(
        (file) => {
          const path = NodePath.join(root, file);
          const isFile = NodeFS.statSync(path, { throwIfNoEntry: false })?.isFile() === true;
          return [file, isFile ? NodeFS.readFileSync(path) : ""];
        },
      ),
    ]);
  const key = inputKey();
  const cachePath = NodePath.join(root, "node_modules", ".cache", "check-changed.json");
  try {
    const cached = JSON.parse(NodeFS.readFileSync(cachePath, "utf8")) as {
      readonly key: string;
      readonly summary: ReadonlyArray<string>;
    };
    if (cached.key === key) {
      console.log("Nothing changed since the last passing run.\n");
      console.log(cached.summary.join("\n"));
      process.exit(0);
    }
  } catch {
    // A missing or unreadable cache is a miss, never a failure.
  }

  const packages = readWorkspace();
  const present = changed.filter((file) => NodeFS.existsSync(NodePath.join(root, file)));
  const { steps, ciAlso } = planSteps({
    changed,
    present,
    packages,
    beside: (dir) => NodeFS.readdirSync(NodePath.join(root, dir)),
    concurrency,
  });
  const results = await runSteps(steps, concurrency, (step) =>
    step.kind === "patches"
      ? checkPatches(root, packages, timeoutSeconds)
      : runPnpm(NodePath.join(root, step.cwd), step.args, timeoutSeconds),
  );

  const summary = [
    "check:changed summary",
    ...results.map((r) => `  ${r.outcome}  ${r.name}  ${r.time}`),
  ];
  if (results.some((r) => r.outcome === "TIMEOUT"))
    summary.push(
      `  TIMEOUT: killed after ${timeoutSeconds}s, not a check failure. Raise --timeout or lower --concurrency.`,
    );
  if (ciAlso.length > 0) summary.push(`  CI also runs: ${ciAlso.join(", ")}`);
  if (!steps.some((s) => s.kind === "patches"))
    summary.push("  lockfile and patch check skipped: no dependency files changed");
  console.log(`\n${summary.join("\n")}`);

  if (results.some((r) => r.outcome !== "pass")) process.exitCode = 1;
  else if (inputKey() !== key) console.log("  pass not cached: files changed during the run");
  else {
    // Write then rename, so a concurrent run never reads half a file.
    NodeFS.mkdirSync(NodePath.dirname(cachePath), { recursive: true });
    NodeFS.writeFileSync(`${cachePath}.${process.pid}`, JSON.stringify({ key, summary }));
    NodeFS.renameSync(`${cachePath}.${process.pid}`, cachePath);
  }
}
