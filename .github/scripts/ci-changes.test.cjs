const assert = require("node:assert/strict");
const { test } = require("node:test");

const { decide, readWorkspace } = require("./ci-changes.cjs");

// The real workspace, so a layout change that breaks readWorkspace fails here, not silently in CI.
const packages = readWorkspace();
const all = ["@xtend/contracts", "@xtend/desktop", "@xtend/pool", "@xtend/web", "xtend"];
const run = (...files) => decide(files, packages);

test("reads every workspace package", () => {
  assert.deepEqual(packages.map((pkg) => pkg.name).sort(), all);
});

test("docs, agent skills and root markdown run only check", () => {
  assert.deepEqual(
    run("docs/operations/development.md", "AGENTS.md", ".agents/skills/test-xtend-app/SKILL.md"),
    { affected: [], outputs: { build: false, test: false } },
  );
});

test("an app change builds and tests that app", () => {
  assert.deepEqual(run("apps/web/src/routes/compose.tsx", "docs/README.md"), {
    affected: ["@xtend/web"],
    outputs: { build: true, test: true },
  });
  assert.deepEqual(run("apps/desktop/src/main.ts").affected, ["@xtend/desktop"]);
});

test("a contracts change reaches every package", () => {
  assert.deepEqual(run("packages/contracts/src/compose.ts"), {
    affected: all,
    outputs: { build: true, test: true },
  });
});

test("root scripts run tests but no build", () => {
  assert.deepEqual(run("scripts/dev-runner.ts", "scripts/dev-runner.test.ts"), {
    affected: [],
    outputs: { build: false, test: true },
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
