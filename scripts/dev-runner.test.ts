import { expect, it } from "vite-plus/test";

import { choosePorts, portsAt, startOffset } from "./dev-runner.ts";

const both = { service: true, web: true };
const freeExcept =
  (...taken: Array<number>) =>
  (port: number) =>
    Promise.resolve(!taken.includes(port));

it("starts the main checkout at the defaults and a worktree at a stable offset of its own", () => {
  const worktree = { path: "/Users/me/.t3/worktrees/xtend/a1b2", linkedWorktree: true };
  const offset = startOffset({ ...worktree, pinned: undefined });

  expect(startOffset({ path: "/Users/me/xtend", linkedWorktree: false, pinned: undefined })).toBe(
    0,
  );
  expect(startOffset({ ...worktree, pinned: undefined })).toBe(offset);
  expect(offset).toBeGreaterThan(0);
  // Below the gap between the bases: a hashed service port never takes a default web port.
  expect(portsAt(offset).service).toBeLessThan(portsAt(0).web);
  expect(startOffset({ ...worktree, path: `${worktree.path}-2`, pinned: undefined })).not.toBe(
    offset,
  );
  expect(startOffset({ ...worktree, pinned: "7" })).toBe(7);
  expect(() => startOffset({ ...worktree, pinned: "-1" })).toThrow("XTEND_PORT_OFFSET");
});

it("moves the whole pair to the next offset when a port it binds is taken", async () => {
  expect(await choosePorts(0, both, freeExcept())).toEqual({ service: 4820, web: 5820 });
  expect(await choosePorts(0, both, freeExcept(4820, 5821))).toEqual(portsAt(2));
  // dev:server binds only the service, so a taken web port does not move it.
  expect(await choosePorts(1, { service: true, web: false }, freeExcept(5821))).toEqual(portsAt(1));
  expect(await choosePorts(0, { service: false, web: true }, freeExcept(5820))).toEqual(portsAt(1));
});

it("skips pairs with a port browsers refuse without probing them", async () => {
  const probed: Array<number> = [];
  const record = (port: number) => {
    probed.push(port);
    return Promise.resolve(true);
  };

  // 4820 + 240 = 5060 and 5061 (SIP), 5820 + 180 = 6000 (X11).
  expect(await choosePorts(240, both, record)).toEqual(portsAt(242));
  expect(await choosePorts(180, both, record)).toEqual(portsAt(181));
  expect(probed).toEqual([5062, 6062, 5001, 6001]);
});
