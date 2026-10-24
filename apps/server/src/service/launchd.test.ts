import { expect, it } from "vite-plus/test";

import { LAUNCHD_LABEL, renderPlist } from "./launchd.ts";

it("renders a KeepAlive user agent with escaped arguments", () => {
  const plist = renderPlist({
    programArguments: ["/usr/local/bin/node", "/Apps/Xtend & Co/bin.mjs", "--base-dir", "/x"],
    baseDir: "/x",
    logPath: "/x/service.log",
    pathEnv: "/usr/bin:/bin",
    electronAsNode: false,
  });
  expect(plist).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
  expect(plist).toContain("<string>/Apps/Xtend &amp; Co/bin.mjs</string>");
  expect(plist).toContain("<string>--base-dir</string>\n    <string>/x</string>");
  expect(plist).toContain("<key>XTEND_SUPERVISOR</key><string>launchd</string>");
  expect(plist).toContain("<key>KeepAlive</key><true/>");
  expect(plist).toContain("<key>StandardErrorPath</key><string>/x/service.log</string>");
  expect(plist).not.toContain("ELECTRON_RUN_AS_NODE");
});

it("runs the packaged app's Electron as Node, not as the app", () => {
  const plist = renderPlist({
    programArguments: ["/Applications/Xtend.app/Contents/MacOS/Xtend", "/x/bin.mjs"],
    baseDir: "/x",
    logPath: "/x/service.log",
    pathEnv: "/usr/bin:/bin",
    electronAsNode: true,
  });
  expect(plist).toContain("<key>ELECTRON_RUN_AS_NODE</key><string>1</string>");
});
