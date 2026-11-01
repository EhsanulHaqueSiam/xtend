import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "vite-plus/test";

import { copyPartition, installedProfile, loginExpiry, profileHolder } from "./dev-x-session.ts";

const temp = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-x-session-"));

/** A partition whose Cookies database holds the named cookies for x.com. */
const partition = (dir: string, cookies: ReadonlyArray<{ name: string; expires: bigint }>) => {
  NodeFS.mkdirSync(dir, { recursive: true });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(dir, "Cookies"));
  db.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER)");
  for (const c of cookies)
    db.prepare("INSERT INTO cookies VALUES ('.x.com', ?, ?)").run(c.name, c.expires);
  db.close();
  return dir;
};
// 2027-01-01T00:00:00Z in Chromium's microseconds since 1601.
const JAN_2027 = (BigInt(Date.UTC(2027, 0, 1)) + 11_644_473_600_000n) * 1000n;

it("copies a partition without Chromium's caches, replacing the target only once complete", () => {
  const dir = temp();
  const from = partition(NodePath.join(dir, "from"), [{ name: "auth_token", expires: JAN_2027 }]);
  for (const cache of ["Cache", "Code Cache", "GPUCache", "Service Worker"])
    NodeFS.mkdirSync(NodePath.join(from, cache, "deep"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(from, "Local Storage", "leveldb"), { recursive: true });
  const to = NodePath.join(dir, "to", "x-session");

  copyPartition(from, to);
  expect(NodeFS.readdirSync(to).toSorted()).toEqual(["Cookies", "Local Storage"]);
  expect(loginExpiry(to)?.toISOString()).toBe("2027-01-01T00:00:00.000Z");

  // A source that is no partition leaves the session already there untouched.
  expect(() => copyPartition(NodePath.join(dir, "nothing"), to)).toThrow("no Cookies file");
  expect(loginExpiry(to)).toBeDefined();
});

it("tells a signed-in partition from a signed-out one", () => {
  const dir = temp();
  expect(
    loginExpiry(partition(NodePath.join(dir, "out"), [{ name: "guest_id", expires: JAN_2027 }])),
  ).toBe(undefined);
  expect(loginExpiry(NodePath.join(dir, "missing"))).toBe(undefined);
});

it("finds the live process holding a profile from Chromium's SingletonLock", () => {
  const live = temp();
  NodeFS.symlinkSync(`host.local-${process.pid}`, NodePath.join(live, "SingletonLock"));
  expect(profileHolder(live)).toBe(process.pid);
  // A crashed desktop leaves its lock behind; it holds nothing.
  const stale = temp();
  NodeFS.symlinkSync("host.local-999999", NodePath.join(stale, "SingletonLock"));
  expect(profileHolder(stale)).toBe(undefined);
  expect(profileHolder(temp())).toBe(undefined);
});

it("finds the installed app's profile where Electron puts it", () => {
  expect(installedProfile("darwin", "/Users/me")).toBe(
    "/Users/me/Library/Application Support/Xtend",
  );
  expect(installedProfile("linux", "/home/me")).toMatch(/\/Xtend$/);
});
