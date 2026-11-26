import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { pinnedVersion, syncReferenceRepo } from "./sync-reference-repos.ts";

it("reads a version from the catalog only, quoted or not", () => {
  const yaml = [
    "packages:",
    "  - apps/*",
    "",
    "catalog:",
    '  "@effect/vitest": 4.0.5',
    "  effect: 4.0.5 # pinned",
    "",
    "overrides:",
    '  effect: "9.9.9"',
  ].join("\n");
  expect(pinnedVersion(yaml, "effect")).toBe("4.0.5");
  expect(pinnedVersion(yaml, "@effect/vitest")).toBe("4.0.5");
  expect(pinnedVersion(yaml, "react")).toBeUndefined();
});

it("clones the pinned tag once into the shared cache and relinks when the pin moves", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-repos-"));
  using _cleanup = { [Symbol.dispose]: () => NodeFS.rmSync(dir, { recursive: true, force: true }) };
  const run = (cwd: string, ...args: Array<string>) =>
    NodeChildProcess.execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      stdio: "pipe",
    });
  // The upstream: two tagged versions.
  const upstream = NodePath.join(dir, "upstream");
  NodeFS.mkdirSync(upstream);
  run(upstream, "init", "-q");
  for (const version of ["1.0.0", "1.1.0"]) {
    NodeFS.writeFileSync(NodePath.join(upstream, "VERSION"), version);
    run(upstream, "add", ".");
    run(upstream, "commit", "-qm", version);
    run(upstream, "tag", `lib@${version}`);
  }
  const root = NodePath.join(dir, "checkout");
  NodeFS.mkdirSync(root);
  run(root, "init", "-q");
  const repo = {
    id: "lib",
    repository: upstream,
    catalogKey: "lib",
    tag: (v: string) => `lib@${v}`,
  };
  const pin = (version: string) =>
    NodeFS.writeFileSync(
      NodePath.join(root, "pnpm-workspace.yaml"),
      `catalog:\n  lib: ${version}\n`,
    );

  pin("1.0.0");
  const first = syncReferenceRepo(root, repo);
  expect(NodeFS.readFileSync(NodePath.join(root, ".repos/lib/VERSION"), "utf8")).toBe("1.0.0");
  expect(NodeFS.existsSync(NodePath.join(first.cached, ".git"))).toBe(false);
  // Synced again (another worktree, or a rerun): the cache is reused as it is.
  expect(syncReferenceRepo(root, repo).cached).toBe(first.cached);

  pin("1.1.0");
  syncReferenceRepo(root, repo);
  expect(NodeFS.readFileSync(NodePath.join(root, ".repos/lib/VERSION"), "utf8")).toBe("1.1.0");
  // The old version's clone stays for worktrees still pinned to it.
  expect(NodeFS.readFileSync(NodePath.join(first.cached, "VERSION"), "utf8")).toBe("1.0.0");
});
