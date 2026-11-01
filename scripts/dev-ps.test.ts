import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { desktopRecordFile, devRecordFile, rows } from "./dev-ps.ts";

const checkout = (records: { dev?: object; desktop?: object }) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-ps-"));
  NodeFS.mkdirSync(NodePath.join(dir, ".xtend"));
  if (records.dev) NodeFS.writeFileSync(devRecordFile(dir), JSON.stringify(records.dev));
  if (records.desktop)
    NodeFS.writeFileSync(desktopRecordFile(dir), JSON.stringify(records.desktop));
  return dir;
};

it("lists each checkout's dev run and desktop with ports, DevTools port, uptime and liveness", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const a = checkout({
    dev: {
      service: 4821,
      web: 5821,
      home: "/a/.xtend",
      pid: 11,
      startedAt: "2026-11-01T11:58:30Z",
    },
    desktop: { pid: 12, remoteDebug: "9224", userData: null, startedAt: "2026-11-01T09:30:00Z" },
  });
  // A record from before PIDs were recorded, and a desktop that crashed.
  const b = checkout({
    dev: { service: 4900, web: 5900, home: "/b/.xtend" },
    desktop: { pid: 13, remoteDebug: null, userData: null, startedAt: "2026-11-01T11:00:00Z" },
  });
  const empty = checkout({});

  expect(rows([a, b, empty], (pid) => pid !== 13, now)).toEqual([
    {
      checkout: a,
      kind: "dev",
      pid: 11,
      ports: "service 4821 web 5821",
      devtools: "-",
      up: "1m30s",
      state: "alive",
    },
    {
      checkout: a,
      kind: "desktop",
      pid: 12,
      ports: "-",
      devtools: "9224",
      up: "2h30m",
      state: "alive",
    },
    {
      checkout: b,
      kind: "dev",
      pid: undefined,
      ports: "service 4900 web 5900",
      devtools: "-",
      up: "?",
      state: "unknown",
    },
    { checkout: b, kind: "desktop", pid: 13, ports: "-", devtools: "-", up: "1h0m", state: "dead" },
  ]);
});
