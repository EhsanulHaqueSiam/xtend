import { expect, it } from "vite-plus/test";

import { cacheKey, closestBase, defaultConcurrency, planSteps } from "./check-changed.ts";

const packages = [
  { dir: "apps/server", name: "xtend" },
  { dir: "apps/web", name: "@xtend/web" },
  { dir: "packages/contracts", name: "@xtend/contracts" },
];
const plan = (
  changed: ReadonlyArray<string>,
  listing: Record<string, ReadonlyArray<string>> = {},
) =>
  planSteps({
    changed,
    present: changed,
    packages,
    beside: (dir) => listing[dir] ?? [],
    concurrency: 4,
  });
const names = (changed: ReadonlyArray<string>, listing?: Record<string, ReadonlyArray<string>>) =>
  plan(changed, listing).steps.map((s) => s.name);

it("sizes the budget by cores and memory, never below one", () => {
  expect(defaultConcurrency(10, 16 * 1024 ** 3)).toBe(2);
  expect(defaultConcurrency(32, 128 * 1024 ** 3)).toBe(16);
  expect(defaultConcurrency(1, 1024 ** 3)).toBe(1);
});

it("compares with the remote main the branch is fewest commits past", () => {
  const remotes = [
    { ref: "origin/main", base: "a", ahead: 7 },
    { ref: "fork/main", base: "b", ahead: 2 },
    { ref: "gone/main", base: undefined, ahead: Infinity },
  ];
  expect(closestBase(remotes)?.ref).toBe("fork/main");
  expect(closestBase([{ ref: "gone/main", base: undefined, ahead: Infinity }])).toBeUndefined();
});

it("formats docs alone, and lints, typechecks and tests what a code change reaches", () => {
  expect(names(["docs/operations/development.md"])).toEqual(["format"]);
  expect(
    names(["apps/web/src/state/x.ts"], {
      "apps/web/src/state": ["x.ts", "x.test.ts", "y.test.ts"],
    }),
  ).toEqual([
    "format",
    "lint",
    "knip",
    "typecheck (1 packages)",
    "typecheck scripts",
    "test @xtend/web",
  ]);
  // Root scripts belong to no package: only their own typecheck runs for them.
  expect(names(["scripts/dev-ps.ts"])).toContain("typecheck scripts");
  expect(names(["scripts/dev-ps.ts"])).not.toContain("typecheck (1 packages)");
  const web = plan(["apps/web/src/state/x.ts"], { "apps/web/src/state": ["x.test.ts"] });
  expect(web.steps.at(-1)).toMatchObject({
    cwd: "apps/web",
    args: ["exec", "vp", "test", "run", "src/state/x.test.ts"],
    serial: true,
  });
  expect(web.ciAlso).toEqual(["full test suites", "e2e journeys", "build", "desktop smoke"]);
});

it("lints every file when a rule or the lint config changes", () => {
  expect(names(["vite.config.ts"])).toContain("lint (rules changed: every file)");
  expect(names(["packages/oxlint-plugin/rules/no-test-in-loop.ts"])).toContain(
    "lint (rules changed: every file)",
  );
});

it("checks the lockfile and patches only when a dependency file changed", () => {
  expect(names(["pnpm-lock.yaml"])[0]).toBe("lockfile and patches");
  expect(names(["patches/@effect__vitest@4.0.5.patch"])[0]).toBe("lockfile and patches");
  expect(names(["apps/web/package.json"])[0]).toBe("lockfile and patches");
  expect(names(["apps/web/src/state/x.ts"])).not.toContain("lockfile and patches");
});

it("runs the payload budgets whenever the service is reached", () => {
  expect(plan(["apps/server/src/ws.ts"]).tests).toContain("apps/server/src/payloads.test.ts");
  expect(plan(["apps/web/src/state/x.ts"]).tests).not.toContain("apps/server/src/payloads.test.ts");
});

it("keys the cache on every part, in order", () => {
  expect(cacheKey(["a", "b"])).toBe(cacheKey(["a", "b"]));
  expect(cacheKey(["a", "b"])).not.toBe(cacheKey(["b", "a"]));
  expect(cacheKey(["ab"])).not.toBe(cacheKey(["a", "b"]));
  expect(cacheKey([new Uint8Array([1])])).not.toBe(cacheKey([new Uint8Array([2])]));
});
