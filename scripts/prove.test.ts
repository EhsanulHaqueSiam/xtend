import { expect, it } from "vite-plus/test";

import { exitCodeOf, projectOf, resultOf } from "./prove.ts";

const report = (failed: number, passed: number, message = "") => ({
  numTotalTests: failed + passed,
  numFailedTests: failed,
  numPassedTests: passed,
  testResults: [{ message }],
});

it("counts only a failed assertion as a failure; a hook error or no report proves nothing", () => {
  expect(resultOf(report(1, 0))).toBe("failed");
  expect(resultOf(report(0, 1))).toBe("passed");
  // beforeAll threw (the app never started): vitest skips the tests and puts the error on the file.
  expect(resultOf({ ...report(0, 0, "service did not come up"), numTotalTests: 1 })).toBe("broken");
  // globalSetup or the build failed: no report was written.
  expect(resultOf(undefined)).toBe("broken");
  // -t matched nothing.
  expect(resultOf(report(0, 0))).toBe("broken");
});

it("proves a fix only when the check fails on the base and passes here", () => {
  expect(exitCodeOf("failed", "passed")).toBe(0);
  expect(exitCodeOf("passed", "passed")).toBe(1);
  expect(exitCodeOf("failed", "failed")).toBe(1);
  expect(exitCodeOf("broken", "passed")).toBe(2);
  expect(exitCodeOf("failed", "broken")).toBe(2);
});

it("runs a scenario in its own project and refuses anything else", () => {
  expect(projectOf("scripts/scenarios/compose.e2e.ts")).toBe("e2e");
  expect(projectOf("scripts/scenarios/engine/edit.engine.ts")).toBe("engine");
  expect(projectOf("scripts/scenarios/mockX/state.test.ts")).toBeUndefined();
  expect(projectOf("apps/web/src/x.e2e.ts")).toBeUndefined();
});
