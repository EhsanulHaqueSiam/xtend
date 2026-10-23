import { expect, it } from "vite-plus/test";

import { LAUNCHD_LABEL, renderPlist } from "./launchd.ts";

it("renders a KeepAlive user agent with escaped arguments", () => {
  const plist = renderPlist({
    programArguments: ["/usr/local/bin/node", "/Apps/Xtend & Co/bin.mjs", "--base-dir", "/x"],
    baseDir: "/x",
    logPath: "/x/service.log",
    pathEnv: "/usr/bin:/bin",
  });
  expect(plist).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
  expect(plist).toContain("<string>/Apps/Xtend &amp; Co/bin.mjs</string>");
  expect(plist).toContain("<string>--base-dir</string>\n    <string>/x</string>");
  expect(plist).toContain("<key>XTEND_SUPERVISOR</key><string>launchd</string>");
  expect(plist).toContain("<key>KeepAlive</key><true/>");
  expect(plist).toContain("<key>StandardErrorPath</key><string>/x/service.log</string>");
});
