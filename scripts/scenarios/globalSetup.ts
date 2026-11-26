import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { APP_DIR } from "./appDir.ts";
import { lockAppDir } from "./lock.ts";

const WEB = NodePath.join(APP_DIR, "apps/web");

/**
 * The service serves apps/web/dist, so each run builds it first: the journeys then meet the
 * current source, config and dependencies, with no freshness check to keep in step with them.
 */
export function buildWeb() {
  // Vitest sets NODE_ENV=test, which would build React's development bundle and the dev token fetch.
  NodeChildProcess.execFileSync(NodePath.join(WEB, "node_modules/.bin/vp"), ["build"], {
    cwd: WEB,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
}

export default function setup() {
  const release = lockAppDir(APP_DIR);
  buildWeb();
  return release;
}
