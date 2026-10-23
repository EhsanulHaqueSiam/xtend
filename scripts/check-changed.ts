// The fast local version of CI for this branch's changes: format and lint of the changed
// files, typecheck of the packages they belong to (all of them when contracts changed),
// knip when code or a manifest changed, and the test files beside the changed files.
// CI still runs everything.
//   pnpm check:changed          against the merge base with origin/main
//   pnpm check:changed <ref>    against the merge base with <ref>
// Uncommitted and untracked files count.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

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
const files = [
  ...new Set([
    ...git("diff", "--name-only", "--no-renames", base.stdout.trim(), "--"),
    ...git("ls-files", "--others", "--exclude-standard"),
  ]),
]
  .filter((file) => NodeFS.existsSync(NodePath.join(root, file)))
  .sort();
if (files.length === 0) {
  console.log("check:changed: nothing changed.");
  process.exit(0);
}

// Workspace packages by directory: apps/* and packages/*.
const packages = ["apps", "packages"].flatMap((group) =>
  NodeFS.readdirSync(NodePath.join(root, group)).flatMap((name) => {
    const manifest = NodePath.join(root, group, name, "package.json");
    if (!NodeFS.existsSync(manifest)) return [];
    const pkg = JSON.parse(NodeFS.readFileSync(manifest, "utf8")) as { name: string };
    return [{ dir: `${group}/${name}`, name: pkg.name }];
  }),
);
const owner = (file: string) => packages.find((p) => file.startsWith(`${p.dir}/`));

const code = files.filter((file) => CODE.test(file));
// Every app imports contracts, so a contract change is checked everywhere.
const affected = files.some((file) => file.startsWith("packages/contracts/"))
  ? packages
  : packages.filter((p) => files.some((file) => owner(file) === p));

// Changed test files and the ones beside a changed source file (foo.ts -> foo.test.ts, foo.browser.test.tsx).
const tests = new Set(code.filter((file) => TEST.test(file)));
for (const file of code) {
  const dir = NodePath.dirname(file);
  const prefix = `${NodePath.basename(file).replace(CODE, "")}.`;
  for (const entry of NodeFS.readdirSync(NodePath.join(root, dir))) {
    if (entry.startsWith(prefix) && TEST.test(entry)) tests.add(NodePath.join(dir, entry));
  }
}

interface Step {
  readonly name: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
}
const steps: Array<Step> = [
  {
    name: "format",
    cwd: root,
    args: ["exec", "vp", "fmt", "--check", "--no-error-on-unmatched-pattern", ...files],
  },
];
if (code.length > 0) steps.push({ name: "lint", cwd: root, args: ["exec", "vp", "lint", ...code] });
for (const p of affected) {
  steps.push({
    name: `typecheck ${p.name}`,
    cwd: NodePath.join(root, p.dir),
    args: ["run", "typecheck"],
  });
}
if (code.length > 0 || files.some((f) => f.endsWith("package.json") || f === "knip.jsonc")) {
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
