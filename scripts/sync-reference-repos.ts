// Read-only reference sources for agents, as T3 Code keeps in `.repos/`: each library at the exact
// version the workspace pins, so an agent reads the API it is really using. Not committed: one
// shallow clone per version sits under git's common dir, shared by every worktree of this clone,
// and `.repos/<id>` links to it. setup-worktree.ts runs this after the install.

//   pnpm sync:repos
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface ReferenceRepo {
  readonly id: string;
  readonly repository: string;
  /** The `catalog:` entry in pnpm-workspace.yaml whose version picks the tag. */
  readonly catalogKey: string;
  readonly tag: (version: string) => string;
}

export const REFERENCE_REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    repository: "https://github.com/Effect-TS/effect.git",
    catalogKey: "effect",
    tag: (version) => `effect@${version}`,
  },
];

/** The version pnpm-workspace.yaml's `catalog:` pins for `key`, or undefined. */
export function pinnedVersion(workspaceYaml: string, key: string) {
  const catalog = /^catalog:\n((?:[ \t]+.*\n?|\n)*)/m.exec(workspaceYaml)?.[1] ?? "";
  const quoted = key.replace(/[.*+?^${}()|[\]\\/@]/g, "\\$&");
  return new RegExp(`^[ \\t]+"?${quoted}"?:\\s*"?([^"\\s#]+)`, "m").exec(catalog)?.[1];
}

const readLink = (path: string) => {
  try {
    return NodeFS.readlinkSync(path);
  } catch {
    return undefined;
  }
};

const git = (args: ReadonlyArray<string>, cwd: string) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

/** Clones the repo at its pinned tag into the shared cache (once) and links `.repos/<id>` to it. */
export function syncReferenceRepo(root: string, repo: ReferenceRepo) {
  const yaml = NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8");
  const version = pinnedVersion(yaml, repo.catalogKey);
  if (version === undefined) throw new Error(`pnpm-workspace.yaml pins no ${repo.catalogKey}`);
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  const cached = NodePath.join(commonDir, "xtend-reference-repos", `${repo.id}@${version}`);
  if (!NodeFS.existsSync(cached)) {
    // Cloned beside the cache and renamed in, so a worktree syncing at the same time never sees half.
    const staging = `${cached}.${process.pid}`;
    NodeFS.mkdirSync(NodePath.dirname(cached), { recursive: true });
    try {
      git(
        ["clone", "--quiet", "--depth=1", "--single-branch", "--branch", repo.tag(version)].concat([
          repo.repository,
          staging,
        ]),
        root,
      );
      // Source to read, not a repository to commit to.
      NodeFS.rmSync(NodePath.join(staging, ".git"), { recursive: true, force: true });
      NodeFS.renameSync(staging, cached);
    } catch (error) {
      if (!NodeFS.existsSync(cached)) throw error;
    } finally {
      NodeFS.rmSync(staging, { recursive: true, force: true });
    }
  }
  const link = NodePath.join(root, ".repos", repo.id);
  NodeFS.mkdirSync(NodePath.dirname(link), { recursive: true });
  if (readLink(link) !== cached) {
    // Made beside it and renamed over it: a sync running at the same time never finds it missing.
    const next = `${link}.${process.pid}`;
    NodeFS.symlinkSync(cached, next, "dir");
    NodeFS.renameSync(next, link);
  }
  return { link, cached, version };
}

if (import.meta.main) {
  const root = NodePath.dirname(import.meta.dirname);
  for (const repo of REFERENCE_REPOS) {
    const { link, version } = syncReferenceRepo(root, repo);
    console.log(`${NodePath.relative(root, link)} -> ${repo.id}@${version}`);
  }
}
