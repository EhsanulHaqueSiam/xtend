// Decides which CI jobs a change needs: prints `key=value` lines for $GITHUB_OUTPUT, and a job
// runs unless its key is "false". A path this does not recognize runs everything, so a new root
// file only costs minutes. scripts/check-changed.ts typechecks the packages this returns.

//   node .github/scripts/ci-changes.cjs --paths <file>   gate by the paths listed in <file>
//   node .github/scripts/ci-changes.cjs                  changed paths unknown: run everything
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

// Never read by a typecheck, build or test. `check` still formats them.
const INERT = [
  /^docs\//,
  /^\.agents\//,
  /^\.devcontainer\//,
  /^skills\//,
  /^\.vite-hooks\//,
  /^[^/]+\.md$/,
  /^\.github\/[^/]+\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^knip\.jsonc$/,
];

// Every app imports these.
const SHARED = /^packages\//;
// These import the apps' source by path (scenarios, dev tooling, evals): an app change reaches them.
const APP_SOURCE = /^(apps|packages)\//;
const IMPORT_APPS = new Set(["scripts", "evals"]);

// Workspace packages by directory, from pnpm-workspace.yaml's `packages:` list (`dir/*` or `dir`).
function readWorkspace() {
  const yaml = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const entries = /^packages:\n((?:[ \t]+-.*\n)+)/m
    .exec(yaml)[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  const dirs = entries.flatMap((entry) =>
    entry.endsWith("/*")
      ? fs
          .readdirSync(path.join(root, entry.slice(0, -2)))
          .map((name) => `${entry.slice(0, -2)}/${name}`)
      : [entry],
  );
  return dirs.flatMap((dir) => {
    const manifest = path.join(root, dir, "package.json");
    if (!fs.existsSync(manifest)) return [];
    return [{ dir, name: JSON.parse(fs.readFileSync(manifest, "utf8")).name }];
  });
}

function decide(files, packages) {
  const all = packages.map((pkg) => pkg.name).sort();
  let everything = files === null;
  let appSource = false;
  const affected = new Set();

  for (const file of files ?? []) {
    if (INERT.some((pattern) => pattern.test(file))) continue;
    const owner = packages.find((pkg) => file.startsWith(`${pkg.dir}/`));
    // A root file (lockfile, workspace, configs, .github) is read by every package or by CI
    // itself, and a manifest can change the dependencies every package resolves.
    if (owner === undefined || path.posix.basename(file) === "package.json") everything = true;
    else if (SHARED.test(owner.dir)) for (const name of all) affected.add(name);
    else affected.add(owner.name);
    if (owner !== undefined && APP_SOURCE.test(owner.dir)) appSource = true;
  }
  if (appSource) for (const pkg of packages) if (IMPORT_APPS.has(pkg.dir)) affected.add(pkg.name);

  const names = everything ? all : [...affected].sort();
  // Every package ends up in the desktop app the smoke test boots, and the engine suite lives in
  // scripts: anything affected builds and tests.
  return { affected: names, outputs: { build: names.length > 0, test: names.length > 0 } };
}

function main() {
  const args = process.argv.slice(2);
  const pathsIndex = args.indexOf("--paths");
  const files =
    pathsIndex === -1
      ? null
      : fs
          .readFileSync(args[pathsIndex + 1], "utf8")
          .split("\n")
          .filter(Boolean);
  const { affected, outputs } = decide(files, readWorkspace());

  console.error(`Affected packages: ${affected.join(", ") || "none"}`);
  for (const [key, value] of Object.entries(outputs)) console.log(`${key}=${value}`);
}

module.exports = { readWorkspace, decide };
if (require.main === module) main();
