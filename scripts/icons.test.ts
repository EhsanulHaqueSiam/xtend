import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { ICON_COPIES, driftedIn } from "./icons.ts";

it("finds the favicon copies that drifted from the mark, and a missing one", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-icons-"));
  using _cleanup = { [Symbol.dispose]: () => NodeFS.rmSync(dir, { recursive: true, force: true }) };
  const write = (path: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(dir, path), text);
  };
  write("assets/prod/icon.svg", "<svg>mark</svg>");
  write(ICON_COPIES[0].to, "<svg>mark</svg>");
  write(ICON_COPIES[1].to, "<svg>old</svg>");
  expect(driftedIn(dir).map((c) => c.to)).toEqual([ICON_COPIES[1].to]);
  NodeFS.rmSync(NodePath.join(dir, ICON_COPIES[0].to));
  expect(driftedIn(dir)).toHaveLength(2);
});
