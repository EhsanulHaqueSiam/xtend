const assert = require("node:assert/strict");
const { test } = require("node:test");

const { decide, readWorkspace } = require("./ci-changes.cjs");

// The real workspace, so a layout change that breaks readWorkspace fails here, not silently in CI.
const packages = readWorkspace();
const all = [
  "@xtend/contracts",
  "@xtend/desktop",
  "@xtend/evals",
  "@xtend/marketing",
  "@xtend/pool",
  "@xtend/scripts",
  "@xtend/web",
  "oxlint-plugin-xtend",
  "xtend",
];
const run = (...files) => decide(files, packages);

test("reads every workspace package", () => {
  assert.deepEqual(packages.map((pkg) => pkg.name).sort(), all);
});

test("docs, agent skills, the dev container and root markdown run only check", () => {
  assert.deepEqual(
    run(
      "docs/operations/00_development.md",
      "AGENTS.md",
      ".agents/skills/test-xtend-app/SKILL.md",
      "skills/xtend/SKILL.md",
      ".devcontainer/devcontainer.json",
      ".github/SECURITY.md",
    ),
    { affected: [], outputs: { build: false, test: false } },
  );
});

test("an app change builds and tests that app and the tools that import its source", () => {
  assert.deepEqual(run("apps/web/src/routes/compose.tsx", "docs/README.md"), {
    affected: ["@xtend/evals", "@xtend/scripts", "@xtend/web"],
    outputs: { build: true, test: true },
  });
  assert.deepEqual(run("apps/desktop/src/main.ts").affected, [
    "@xtend/desktop",
    "@xtend/evals",
    "@xtend/scripts",
  ]);
});

test("a contracts change reaches every package", () => {
  assert.deepEqual(run("packages/contracts/src/compose.ts"), {
    affected: all,
    outputs: { build: true, test: true },
  });
});

test("the lint plugin, the pool worker and the scenarios reach only themselves", () => {
  assert.deepEqual(run("oxlint-plugin-xtend/rules/no-test-in-loop.ts").affected, [
    "oxlint-plugin-xtend",
  ]);
  assert.deepEqual(run("infra/pool/src/index.ts").affected, ["@xtend/pool"]);
  assert.deepEqual(run("scripts/scenarios/engine/spaces.engine.ts"), {
    affected: ["@xtend/scripts"],
    outputs: { build: true, test: true },
  });
});

test("the lockfile, a manifest, a root config or CI itself runs everything", () => {
  for (const file of [
    "pnpm-lock.yaml",
    "apps/web/package.json",
    "tsconfig.base.json",
    ".github/workflows/ci.yml",
  ]) {
    assert.deepEqual(run(file), { affected: all, outputs: { build: true, test: true } }, file);
  }
});

test("an unknown base runs everything", () => {
  assert.deepEqual(decide(null, packages), {
    affected: all,
    outputs: { build: true, test: true },
  });
});
