import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import buildWeb from "../globalSetup.ts";

const DESKTOP = NodeURL.fileURLToPath(new URL("../../../desktop/", import.meta.url));

/** The web app the service serves and the desktop's main and preloads, built from this source. */
export default function setup() {
  buildWeb();
  NodeChildProcess.execFileSync(NodePath.join(DESKTOP, "node_modules/.bin/vp"), ["pack"], {
    cwd: DESKTOP,
    stdio: "inherit",
  });
}
