import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../../web/", import.meta.url));

/**
 * The service serves apps/web/dist, so each run builds it first: the journeys then meet the
 * current source, config and dependencies, with no freshness check to keep in step with them.
 */
export default function setup() {
  // Vitest sets NODE_ENV=test, which would build React's development bundle and the dev token fetch.
  execFileSync(join(WEB, "node_modules/.bin/vp"), ["build"], {
    cwd: WEB,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
}
