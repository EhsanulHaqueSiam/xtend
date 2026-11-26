import * as NodePath from "node:path";

/**
 * The checkout whose app the scenarios start: its service, its built web app and its desktop. This
 * one unless XTEND_SCENARIO_APP_DIR names another; `pnpm prove` points it at a base worktree, so the
 * same scenarios (and mock X) run against main's app and this branch's.
 */
export const APP_DIR = NodePath.resolve(
  process.env.XTEND_SCENARIO_APP_DIR ?? NodePath.join(import.meta.dirname, "../.."),
);
