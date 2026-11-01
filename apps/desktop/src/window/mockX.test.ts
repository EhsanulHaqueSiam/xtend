import * as NodeEvents from "node:events";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { expect, it, vi } from "vite-plus/test";

import { sessionPartition } from "./guestPolicy.ts";
import { MOCK_X_PARTITION, mockForward, mockXOrigin } from "./mockX.ts";

vi.mock("electron", () => import("../testing/fakeElectron.ts"));

it("serves x.com from mock X only in a dev build, and only from this machine", () => {
  expect(mockXOrigin("http://127.0.0.1:4830", false)).toBe("http://127.0.0.1:4830");
  expect(mockXOrigin("http://localhost:4830/home", false)).toBe("http://localhost:4830");
  // A packaged app is a user's: it never serves X from anything but X.
  expect(mockXOrigin("http://127.0.0.1:4830", true)).toBeNull();
  for (const elsewhere of [
    "https://x.com",
    "http://10.0.0.2:4830",
    "http://mini.tail.ts.net:4830",
    "file:///tmp/x",
    "4830",
    "",
  ])
    expect(mockXOrigin(elsewhere, false)).toBeNull();
  expect(mockXOrigin(undefined, false)).toBeNull();
});

it("keeps mock X off every account's partition and off disk", () => {
  expect(MOCK_X_PARTITION.startsWith("persist:")).toBe(false);
  const accounts = Array.from({ length: 1_000 }, (_, i) => sessionPartition(i + 1));
  expect(accounts).not.toContain(MOCK_X_PARTITION);
  expect(accounts.map((p) => p.slice("persist:".length))).not.toContain(MOCK_X_PARTITION);
});

/** A local server that records the paths it was asked for and answers with `answer`. */
const server = async (answer: (res: NodeHttp.ServerResponse, path: string) => void) => {
  const paths: Array<string> = [];
  const s = NodeHttp.createServer((req, res) => {
    paths.push(req.url ?? "");
    answer(res, req.url ?? "");
  }).listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(s, "listening");
  const { port } = s.address() as NodeNet.AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, paths, close: () => s.close() };
};

it("sends x.com only to the mock: no path or redirect takes a request anywhere else", async () => {
  const elsewhere = await server((res) => res.end("reached"));
  const mock = await server((res, path) => {
    if (path === "/hop") res.writeHead(302, { location: `${elsewhere.origin}/` }).end();
    else res.end("mock");
  });
  try {
    const forward = mockForward(mock.origin, () => {});
    const host = new URL(elsewhere.origin).host;

    // A path that reads as another host stays a path on the mock.
    const odd = await forward(new Request(`https://x.com//${host}/`));
    expect(await odd.text()).toBe("mock");
    expect(mock.paths).toEqual([`//${host}/`]);
    // The mock's redirect goes back to the page, whose next request meets this check again.
    const hop = await forward(new Request("https://x.com/hop"));
    expect([hop.status, hop.headers.get("location")]).toEqual([302, `${elsewhere.origin}/`]);
    expect((await forward(new Request(`${elsewhere.origin}/`))).status).toBe(404);
    expect((await forward(new Request("https://example.com/"))).status).toBe(404);
    expect(elsewhere.paths).toEqual([]);
  } finally {
    mock.close();
    elsewhere.close();
  }
});
