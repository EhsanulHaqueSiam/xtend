import { expect, it } from "vite-plus/test";

import { decide, deepLinkToRoute, nextRestart } from "./supervision.ts";

it("picks the mode from the probe", () => {
  const local = { remote: false, reachable: false, loopback: true, launchdLoaded: false };
  expect(decide({ ...local, reachable: true, loopback: false })).toEqual({
    mode: "remote",
    spawn: false,
  });
  expect(decide({ ...local, launchdLoaded: true })).toEqual({ mode: "launchd", spawn: false });
  expect(decide({ ...local, reachable: true })).toEqual({ mode: "none", spawn: false });
  expect(decide(local)).toEqual({ mode: "child", spawn: true });
});

it("never starts a local service in place of a saved remote, even one tunnelled to localhost", () => {
  expect(decide({ remote: true, reachable: false, loopback: true, launchdLoaded: false })).toEqual({
    mode: "remote",
    spawn: false,
  });
  expect(decide({ remote: true, reachable: false, loopback: true, launchdLoaded: true })).toEqual({
    mode: "remote",
    spawn: false,
  });
});

it("backs off per crash and resets after a stable run", () => {
  expect(nextRestart(0, 100)).toEqual({ attempt: 1, delayMs: 2_000 });
  expect(nextRestart(3, 100)).toEqual({ attempt: 4, delayMs: 30_000 });
  expect(nextRestart(9, 100)).toEqual({ attempt: 10, delayMs: 30_000 });
  expect(nextRestart(4, 120_000)).toEqual({ attempt: 0, delayMs: 1_000 });
});

it("maps deep links to routes and refuses the rest", () => {
  expect(deepLinkToRoute("xtend://compose?text=hello%20world")).toBe("/compose?text=hello+world");
  expect(deepLinkToRoute("xtend://compose")).toBe("/compose");
  expect(deepLinkToRoute("xtend://report?handle=@levelsio")).toBe("/scores?handle=levelsio");
  expect(deepLinkToRoute("xtend://report?handle=not%20a%20handle")).toBeNull();
  expect(deepLinkToRoute("https://x.com/compose")).toBeNull();
  expect(deepLinkToRoute("xtend://settings")).toBeNull();
});
