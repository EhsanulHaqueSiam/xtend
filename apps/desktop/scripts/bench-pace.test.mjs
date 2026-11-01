import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { accountKey, pace, readStarts } from "./bench-pace.mjs";

const MIN = 60_000;
const NOW = Date.parse("2026-11-01T15:00:00Z");
const ago = (...minutes) => minutes.map((m) => NOW - m * MIN);

it("waits five minutes after the last run and while more than four started in thirty", () => {
  expect(pace([], NOW)).toEqual({ ok: true });
  expect(pace(ago(6, 40, 50), NOW)).toEqual({ ok: true });
  expect(pace(ago(3), NOW)).toMatchObject({ ok: false, until: NOW + 2 * MIN });
  // Four in the window is fine; a fifth recorded one is not, until the oldest leaves.
  expect(pace(ago(6, 12, 18, 24), NOW)).toEqual({ ok: true });
  expect(pace(ago(6, 12, 18, 24, 29), NOW)).toMatchObject({
    ok: false,
    until: NOW + 1 * MIN,
    why: "5 runs started in the last 30 minutes",
  });
  // Both at once, the later wait wins: two of six must leave, the second at 25 minutes ago.
  expect(pace(ago(1, 10, 15, 20, 25, 28), NOW)).toMatchObject({ ok: false, until: NOW + 5 * MIN });
});

it("reads every branch's results for one account, counting a run that died before its first round", () => {
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
  const at = (...iso) => iso.map((s) => Date.parse(s));
  expect(readStarts(dir, mine).toSorted()).toEqual(
    at("2026-11-01T14:01:00Z", "2026-11-01T14:07:00Z", "2026-11-01T14:30:00Z"),
  );
  // An account the bench could not tell paces against every run.
  expect(readStarts(dir, undefined)).toHaveLength(4);
  expect(readStarts(NodePath.join(dir, "missing"), mine)).toEqual([]);
  // The key names nobody: not the id, stable, and different per account.
  expect(mine).not.toContain("44196397");
  expect(accountKey("44196397")).toBe(mine);
});
