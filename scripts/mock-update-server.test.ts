import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { fileFor, serveFolder } from "./mock-update-server.ts";

const folder = () => {
  const base = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-feed-"));
  const root = NodePath.join(base, "release");
  NodeFS.mkdirSync(root);
  NodeFS.writeFileSync(NodePath.join(root, "latest-linux.yml"), "version: 9.9.9\n");
  NodeFS.writeFileSync(NodePath.join(base, "secret.txt"), "nope\n");
  NodeFS.symlinkSync(NodePath.join(base, "secret.txt"), NodePath.join(root, "link.txt"));
  return {
    root,
    [Symbol.dispose]: () => NodeFS.rmSync(base, { recursive: true, force: true }),
  };
};

it("names files inside the folder and nothing outside it, however the path is spelled", () => {
  using feed = folder();
  expect(fileFor(feed.root, "/latest-linux.yml?noCache=1")).toMatch(/latest-linux\.yml$/);
  expect(fileFor(feed.root, "/../secret.txt")).toBeNull();
  expect(fileFor(feed.root, "/%2e%2e/secret.txt")).toBeNull();
  expect(fileFor(feed.root, "/link.txt")).toBeNull();
  expect(fileFor(feed.root, "/")).toBeNull();
  expect(fileFor(feed.root, "/%E0%A4%A")).toBeNull();
});

it("serves a feed file over HTTP and 404s the rest", async () => {
  using feed = folder();
  const server = serveFolder(feed.root);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    const yml = await fetch(`http://127.0.0.1:${port}/latest-linux.yml`);
    expect(yml.status).toBe(200);
    expect(await yml.text()).toBe("version: 9.9.9\n");
    expect((await fetch(`http://127.0.0.1:${port}/%2e%2e/secret.txt`)).status).toBe(404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
