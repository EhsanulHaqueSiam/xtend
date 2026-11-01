import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { startFakeTreg } from "../apps/e2e/src/fakeTreg.ts";
import {
  choosePorts,
  fakePortOf,
  parseFlags,
  portsAt,
  readFixture,
  startOffset,
} from "./dev-runner.ts";

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

it("seeds demo data by default, and refuses a seed it does not know or the live install", () => {
  expect(parseFlags([], undefined)).toMatchObject({ home: undefined, seed: "demo", live: false });
  expect(parseFlags(["--no-seed"], "real").seed).toBe("none");
  expect(parseFlags([], "real").seed).toBe("real");
  expect(parseFlags(["--seed", "none", "--live", "--home", "/tmp/x"], undefined)).toMatchObject({
    home: "/tmp/x",
    seed: "none",
    live: true,
  });
  expect(() => parseFlags(["--seed", "prod"], undefined)).toThrow("--seed takes");
  expect(() =>
    parseFlags(["--home", NodePath.join(NodeOS.homedir(), ".xtend")], undefined),
  ).toThrow("live install");
});

it("keeps the fake clear of every checkout's service and web ports", () => {
  for (const offset of [0, 1, 998])
    expect(fakePortOf(portsAt(offset))).toBeGreaterThan(portsAt(998).web);
});

it("answers treg, the pool and the model locally, recording only treg calls", async () => {
  const fake = await startFakeTreg();
  try {
    const post = (path: string, body: unknown) =>
      fetch(`${fake.url}${path}`, { method: "POST", body: JSON.stringify(body) });
    const search = await post("/call/anyapi.x.search.posts", { query: "saas" });
    expect(search.headers.get("x-treg-cost-usd")).toBe("0.002");
    const { output } = (await search.json()) as { output: { data: { items: Array<unknown> } } };
    expect(output.data.items.length).toBeGreaterThan(1);
    expect(await (await post("/register", {})).json()).toEqual({ installId: "fake" });
    const answer = await post("/chat/completions", {
      response_format: {
        json_schema: {
          schema: {
            type: "object",
            properties: { hooks: { type: "array", items: { type: "string" } }, n: { enum: [3] } },
          },
        },
      },
    });
    const { choices } = (await answer.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    expect(JSON.parse(choices[0]!.message.content)).toEqual({
      hooks: ["A sample answer from the fake model."],
      n: 3,
    });
    expect(fake.calls.map((c) => c.endpoint)).toEqual(["anyapi.x.search.posts"]);
  } finally {
    await fake.close();
  }
});

const root = NodePath.resolve(import.meta.dirname, "..");
const fixtures = NodeFS.readdirSync(NodePath.join(root, "scripts", "fixtures"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

it("takes a fixture by name and refuses a path for one", () => {
  expect(parseFlags(["--fixture", "failed-posts", "--fresh"], undefined)).toMatchObject({
    fixture: "failed-posts",
    fresh: true,
  });
  expect(() => parseFlags(["--fixture", "../../.xtend"], undefined)).toThrow("--fixture");
  expect(() => readFixture(root, "no-such-state")).toThrow("Known:");
});

it.each(fixtures)("fixture %s says what it shows, what it starts from and where", (name) => {
  const fixture = readFixture(root, name);
  expect(fixture.description.length).toBeGreaterThan(20);
  expect(fixture.open.startsWith("/")).toBe(true);
});
