import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { accountKey, estimate, locked, pace, readSpent } from "./bench-pace.mjs";

const MIN = 60_000;
const NOW = Date.parse("2026-11-01T15:00:00Z");
const spent = (...rounds) =>
  rounds.map(([minutesAgo, calls]) => ({ at: NOW - minutesAgo * MIN, calls }));

it("keeps the last fifteen minutes' X calls and the next round's within the budget", () => {
  expect(pace([], NOW, 300)).toEqual({ ok: true, used: 0 });
  // A one-check round fits beside two full ones; a third full one waits for the first to leave.
  expect(pace(spent([2, 280], [8, 290]), NOW, 20)).toEqual({ ok: true, used: 570 });
  expect(pace(spent([2, 280], [8, 290]), NOW, 300)).toEqual({
    ok: false,
    used: 570,
    until: NOW + 7 * MIN,
  });
  // Rounds older than the window cost nothing.
  expect(pace(spent([16, 600], [40, 600]), NOW, 300)).toMatchObject({ ok: true });
  // A round bigger than the whole budget waits for an empty window, then runs.
  expect(pace(spent([5, 10], [1, 10]), NOW, 900)).toEqual({
    ok: false,
    used: 20,
    until: NOW + 14 * MIN,
  });
  expect(pace([], NOW, 900)).toMatchObject({ ok: true });
});

it("reads every branch's rounds for one account, counting a run that died before its first round", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-bench-"));
  const mine = accountKey("44196397");
  const write = (branch, name, report) => {
    NodeFS.mkdirSync(NodePath.join(dir, branch), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, branch, name), JSON.stringify(report));
  };
  write("main", "a.json", {
    account: mine,
    startedAt: "2026-11-01T14:00:00Z",
    runs: [{ startedAt: "2026-11-01T14:01:00Z" }, { startedAt: "2026-11-01T14:07:00Z" }],
  });
  write("feat-x", "b.json", { account: mine, startedAt: "2026-11-01T14:30:00Z", runs: [] });
  write("feat-x", "c.json", {
    account: accountKey("12"),
    startedAt: "2026-11-01T14:50:00Z",
    runs: [],
  });
  write("feat-x", "broken.json", "{");
  const at = (iso) => Date.parse(iso);
  // Uncounted rounds (recorded before rounds counted) cost a full round each.
  expect(readSpent(dir, mine).toSorted((x, y) => x.at - y.at)).toEqual([
    { at: at("2026-11-01T14:01:00Z"), calls: 300 },
    { at: at("2026-11-01T14:07:00Z"), calls: 300 },
    { at: at("2026-11-01T14:30:00Z"), calls: 300 },
  ]);
  // An account the bench could not tell paces against every run.
  expect(readSpent(dir, undefined)).toHaveLength(4);
  expect(readSpent(NodePath.join(dir, "missing"), mine)).toEqual([]);
  // The key names nobody: not the id, stable, and different per account.
  expect(mine).not.toContain("44196397");
  expect(accountKey("44196397")).toBe(mine);
});

it("counts a round by its calls, or what it planned while it runs, and estimates from counted rounds", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-bench-"));
  const mine = accountKey("44196397");
  NodeFS.mkdirSync(NodePath.join(dir, "main"));
  const checks = (n) => Array.from({ length: n }, (_, i) => ({ name: `check ${i}` }));
  const write = (name, report) =>
    NodeFS.writeFileSync(
      NodePath.join(dir, "main", name),
      JSON.stringify({ account: mine, ...report }),
    );
  // Before any counted round, a check is taken as eight calls.
  expect(estimate(dir, mine, 10)).toBe(80);
  write("a.json", {
    startedAt: "2026-11-01T14:00:00Z",
    runs: [
      {
        startedAt: "2026-11-01T14:00:00Z",
        endedAt: "2026-11-01T14:05:00Z",
        planned: 320,
        calls: 200,
        checks: checks(40),
      },
      { startedAt: "2026-11-01T14:06:00Z", planned: 160, calls: null, checks: checks(3) },
    ],
  });
  write("b.json", { startedAt: "2026-11-01T14:10:00Z", planned: 42, runs: [] });
  expect(
    readSpent(dir, mine)
      .map((s) => s.calls)
      .toSorted((x, y) => x - y),
  ).toEqual([42, 160, 200]);
  expect(estimate(dir, mine, 3)).toBe(15);
});

it("lets one checkout at a time check the budget and book", async () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-bench-"));
  let inside = 0;
  let most = 0;
  const step = () =>
    locked(dir, async () => {
      most = Math.max(most, ++inside);
      await Promise.resolve();
      inside--;
    });
  await Promise.all([step(), step(), step()]);
  expect(most).toBe(1);
  expect(NodeFS.existsSync(NodePath.join(dir, ".pace-lock"))).toBe(false);
});
