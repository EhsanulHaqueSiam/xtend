// The fast local version of CI for this branch's changes: format and lint of the changed files,
// typecheck of the packages they reach (per .github/scripts/ci-changes.cjs, as CI gates), knip
// when code or a manifest changed, and the tests beside the changed files. Uncommitted and
// untracked files count; CI still runs the full suites.

//   pnpm check:changed          against the merge base with origin/main
//   pnpm check:changed <ref>    against the merge base with <ref>
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { decide, readWorkspace } from "../.github/scripts/ci-changes.cjs";

const root = NodePath.resolve(import.meta.dirname, "..");
const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;

const git = (...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const ref = process.argv[2] ?? "origin/main";
const base = NodeChildProcess.spawnSync("git", ["merge-base", "HEAD", ref], {
  cwd: root,
  encoding: "utf8",
});
if (base.status !== 0) {
  console.error(
    `check:changed: no merge base with ${ref}. Run \`git fetch origin\` or pass a ref.`,
  );
  process.exit(1);
}
const changed = [
  ...new Set([
    ...git("diff", "--name-only", "--no-renames", base.stdout.trim(), "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
].sort();
if (changed.length === 0) {
  console.log("check:changed: nothing changed.");
  process.exit(0);
}
// Deleted files cannot be formatted or linted, but still count for typecheck and knip:
// removing a module can break its importers or leave an export unused.
const files = changed.filter((file) => NodeFS.existsSync(NodePath.join(root, file)));

const packages = readWorkspace();
const owner = (file: string) => packages.find((p) => file.startsWith(`${p.dir}/`));
const reached = new Set(decide(changed, packages).affected);
const affected = packages.filter((p) => reached.has(p.name));

const code = files.filter((file) => CODE.test(file));

// Changed test files and the ones beside a changed source file (foo.ts -> foo.test.ts, foo.browser.test.tsx).
const tests = new Set(code.filter((file) => TEST.test(file)));
for (const file of code) {
  const dir = NodePath.dirname(file);
  const prefix = `${NodePath.basename(file).replace(CODE, "")}.`;
  for (const entry of NodeFS.readdirSync(NodePath.join(root, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.join(dir, entry));
  }
}

// The WebSocket payload budgets sit beside no source file they guard.
if (reached.has("xtend")) tests.add("apps/server/src/payloads.test.ts");

interface Step {
  readonly name: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
}
const steps: Array<Step> = [];
// No files would make fmt check the whole repo.
if (files.length > 0) {
  steps.push({
    name: "format",
    cwd: root,
    args: ["exec", "vp", "fmt", "--check", "--no-error-on-unmatched-pattern", ...files],
  });
}
// A rule or config change can flag files this branch never touched, so it lints everything.
const LINT = ["exec", "vp", "lint", "--deny-warnings", "--report-unused-disable-directives"];
if (changed.some((f) => f === "vite.config.ts" || f.startsWith("packages/oxlint-plugin/"))) {
  steps.push({ name: "lint (rules changed: every file)", cwd: root, args: LINT });
} else if (code.length > 0) {
  steps.push({ name: "lint", cwd: root, args: [...LINT, ...code] });
}
for (const p of affected) {
  steps.push({
    name: `typecheck ${p.name}`,
    cwd: NodePath.join(root, p.dir),
    args: ["run", "typecheck"],
  });
}
if (changed.some((f) => CODE.test(f) || f.endsWith("package.json") || f === "knip.jsonc")) {
  steps.push({ name: "knip", cwd: root, args: ["exec", "knip"] });
}
// Root scripts/ belong to no package; their tests run under the root config, as in `pnpm test`.
const rootTests = [...tests].filter((file) => file.startsWith("scripts/"));
if (rootTests.length > 0) {
  steps.push({
    name: "test scripts",
    cwd: root,
    args: ["exec", "vp", "test", "run", ...rootTests],
  });
}
// .github/scripts tests run under node --test, as in `pnpm test`.
const githubTests = [...tests].filter((file) => file.startsWith(".github/"));
if (githubTests.length > 0) {
  steps.push({
    name: "test .github/scripts",
    cwd: root,
    args: ["exec", "node", "--test", ...githubTests],
  });
}
for (const p of packages) {
  const own = [...tests]
    .filter((file) => owner(file) === p)
    .map((file) => file.slice(p.dir.length + 1));
  if (own.length > 0) {
    steps.push({
      name: `test ${p.name}`,
      cwd: NodePath.join(root, p.dir),
      args: ["exec", "vp", "test", "run", ...own],
    });
  }
}

const failed: Array<string> = [];
for (const step of steps) {
  console.log(`\n> ${step.name}`);
  const result = NodeChildProcess.spawnSync("pnpm", step.args, { cwd: step.cwd, stdio: "inherit" });
  if (result.status !== 0) failed.push(step.name);
}
console.log(
  `\ncheck:changed: ${files.length} files, ${steps.length} steps, ${failed.length === 0 ? "all passed" : `failed: ${failed.join(", ")}`}.`,
);
process.exit(failed.length === 0 ? 0 : 1);
