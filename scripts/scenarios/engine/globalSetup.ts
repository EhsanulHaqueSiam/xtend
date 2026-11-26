import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { APP_DIR } from "../appDir.ts";
import { buildWeb } from "../globalSetup.ts";
import { lockAppDir } from "../lock.ts";

const DESKTOP = NodePath.join(APP_DIR, "apps/desktop");

/** The web app the service serves and the desktop's main and preloads, built from this source. */
export default function setup() {
  const release = lockAppDir(APP_DIR);
  buildWeb();
  // XTEND_DESKTOP_DEV makes the pack launch a desktop when it finishes, outside the harness.
  const { XTEND_DESKTOP_DEV: _launch, ...env } = process.env;
  NodeChildProcess.execFileSync(NodePath.join(DESKTOP, "node_modules/.bin/vp"), ["pack"], {
    cwd: DESKTOP,
    stdio: "inherit",
    env,
  });
  return release;
}
