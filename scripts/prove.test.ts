import { expect, it } from "vite-plus/test";

import { projectOf, verdict } from "./prove.ts";

it("proves a fix only when the scenario fails on the base and passes here", () => {
  expect(verdict(false, true)).toBe("proved");
  expect(verdict(true, true)).toBe("passes on base");
  expect(verdict(false, false)).toBe("fails on both");
  expect(verdict(true, false)).toBe("fails here");
});

it("runs a scenario in its own project and refuses anything else", () => {
  expect(projectOf("scripts/scenarios/compose.e2e.ts")).toBe("e2e");
  expect(projectOf("scripts/scenarios/engine/edit.engine.ts")).toBe("engine");
  expect(projectOf("scripts/scenarios/mockX/state.test.ts")).toBeUndefined();
  expect(projectOf("apps/web/src/x.e2e.ts")).toBeUndefined();
});
