import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { lockAppDir } from "./lock.ts";

it("refuses a live holder, takes over a dead one, and releases only its own lock", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-lock-"));
  using _cleanup = { [Symbol.dispose]: () => NodeFS.rmSync(dir, { recursive: true, force: true }) };
  const file = NodePath.join(dir, "node_modules", ".cache", "xtend-scenarios.lock");
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });

  // Our parent is alive and not us: another run.
  NodeFS.writeFileSync(file, String(process.ppid));
  expect(() => lockAppDir(dir)).toThrow(`pid ${process.ppid}`);

  // A finished process left its lock behind.
  const dead = NodeChildProcess.spawnSync(process.execPath, ["-e", ""]).pid!;
  NodeFS.writeFileSync(file, String(dead));
  const release = lockAppDir(dir);
  expect(NodeFS.readFileSync(file, "utf8")).toBe(String(process.pid));
  expect(NodeFS.readdirSync(NodePath.dirname(file))).toEqual(["xtend-scenarios.lock"]);
  // Both scenario projects in one process share it.
  expect(lockAppDir(dir)).toBeTypeOf("function");

  release();
  expect(NodeFS.existsSync(file)).toBe(false);
  // Released twice (both projects' teardowns): nothing to remove, no error.
  release();
});
