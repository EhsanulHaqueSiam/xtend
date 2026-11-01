// Decides which CI jobs a change needs: prints `key=value` lines for $GITHUB_OUTPUT, and a job
// runs unless its key is "false". A path this does not recognize runs everything, so a new root
// file only costs minutes. scripts/check-changed.ts typechecks the packages this returns.

//   node .github/scripts/ci-changes.cjs --paths <file>   gate by the paths listed in <file>
//   node .github/scripts/ci-changes.cjs                  changed paths unknown: run everything
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

// Never read by a typecheck, build or test. `check` still formats them.
const INERT = [/^docs\//, /^\.agents\//, /^\.vite-hooks\//, /^[^/]+\.md$/, /^knip\.jsonc$/];

// Workspace packages by directory: apps/* and packages/*, as in pnpm-workspace.yaml.
function readWorkspace() {
  return ["apps", "packages"].flatMap((group) =>
    fs.readdirSync(path.join(root, group)).flatMap((name) => {
      const manifest = path.join(root, group, name, "package.json");
      if (!fs.existsSync(manifest)) return [];
      return [
        { dir: `${group}/${name}`, name: JSON.parse(fs.readFileSync(manifest, "utf8")).name },
      ];
    }),
  );
}

function decide(files, packages) {
  const all = packages.map((pkg) => pkg.name).sort();
  let everything = files === null;
  let scripts = false;
  const affected = new Set();

  for (const file of files ?? []) {
    if (INERT.some((pattern) => pattern.test(file))) continue;
    // Root scripts belong to no package and no build reads them; only `pnpm test` runs them.
    if (file.startsWith("scripts/")) {
      scripts = true;
      continue;
    }
    const owner = packages.find((pkg) => file.startsWith(`${pkg.dir}/`));
    // A root file (lockfile, workspace, configs, .github) is read by every package or by CI
    // itself, and a manifest can change the dependencies every package resolves.
    if (owner === undefined || path.posix.basename(file) === "package.json") everything = true;
    // Every app imports the shared packages.
    // The lint plugin is loaded by vite.config.ts, never imported: it reaches only itself.
    else if (owner.dir.startsWith("packages/") && owner.dir !== "packages/oxlint-plugin")
      for (const name of all) affected.add(name);
    else affected.add(owner.name);
  }

  const names = everything ? all : [...affected].sort();
  return {
    affected: names,
    outputs: {
      // Every package ends up in the desktop app the smoke test boots, web included.
      build: names.length > 0,
      test: names.length > 0 || scripts,
    },
  };
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
