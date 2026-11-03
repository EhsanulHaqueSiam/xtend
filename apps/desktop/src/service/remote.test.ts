import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { checkRemote, readDeviceId, readRemote, redeemPairing, writeRemote } from "./remote.ts";

const fetchOk = (name: string) => async () => ({
  ok: true,
  json: async () => ({ name, version: "0.0.1" }),
});

it("reports health and token acceptance separately", async () => {
  const seen: Array<string> = [];
  const result = await checkRemote(
    { url: "https://mini.tail.ts.net:4820", token: "abc" },
    {
      fetch: async (url) => {
        seen.push(url);
        return fetchOk("xtend")();
      },
      openSocket: async (url) => {
        seen.push(url);
        return true;
      },
    },
  );
  expect(result).toEqual({ health: true, version: "0.0.1", auth: true, error: null });
  expect(seen).toEqual([
    "https://mini.tail.ts.net:4820/api/health",
    "wss://mini.tail.ts.net:4820/ws?token=abc",
  ]);
});

it("tells a wrong token from a wrong host", async () => {
  const refused = await checkRemote(
    { url: "http://10.0.0.5:4820", token: "nope" },
    { fetch: fetchOk("xtend"), openSocket: async () => false },
  );
  expect(refused).toMatchObject({
    health: true,
    auth: false,
    error: "the service refused the token",
  });
  const other = await checkRemote(
    { url: "http://10.0.0.5:80", token: "x" },
    { fetch: fetchOk("nginx"), openSocket: async () => true },
  );
  expect(other).toMatchObject({ health: false, auth: false });
  const down = await checkRemote(
    { url: "http://10.0.0.9:4820", token: "x" },
    {
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      openSocket: async () => true,
    },
  );
  expect(down.error).toContain("ECONNREFUSED");
});

it("keeps the saved remote across launches, and ignores one whose URL would stop the app starting", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-remote-"));
  const file = NodePath.join(dir, "config.json");
  try {
    expect(readRemote(file)).toBeNull();
    writeRemote(file, { url: "http://mini.tail.ts.net:4820", token: "abc" });
    expect(readRemote(file)).toEqual({ url: "http://mini.tail.ts.net:4820", token: "abc" });
    // The token in it is the service's key; only this user may read it.
    expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
    writeRemote(file, null);
    expect(readRemote(file)).toBeNull();
    for (const url of ["mini:4820", "ftp://mini:4820", "http://[mini"]) {
      NodeFS.writeFileSync(file, JSON.stringify({ remote: { url, token: "abc" } }));
      expect(readRemote(file)).toBeNull();
    }
    NodeFS.writeFileSync(file, "{ not json");
    expect(readRemote(file)).toBeNull();
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps this desktop's id across launches and remote changes", () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-device-"));
  const file = NodePath.join(dir, "config.json");
  try {
    const id = readDeviceId(file);
    writeRemote(file, { url: "http://mini:4820", token: "abc" });
    writeRemote(file, null);
    expect(readDeviceId(file)).toBe(id);
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

const PREFS = { cleanX: ["ads" as const], updateChannel: null };

it("joins with a pairing link's code and keeps the token the service hands back", async () => {
  const sent: Array<[string, unknown]> = [];
  const joined = await redeemPairing(
    "http://100.64.0.1:4820/pair#k7Qm2xVa",
    { id: "dev-0001", name: "MacBook", prefs: PREFS },
    async (url, body) => {
      sent.push([url, JSON.parse(body)]);
      return { ok: true, json: async () => ({ token: "t0k" }) };
    },
  );
  expect(joined).toEqual({ remote: { url: "http://100.64.0.1:4820", token: "t0k" } });
  expect(sent).toEqual([
    [
      "http://100.64.0.1:4820/api/pair",
      { code: "k7Qm2xVa", id: "dev-0001", name: "MacBook", prefs: PREFS },
    ],
  ]);
  const refused = await redeemPairing(
    "http://mini:4820/pair#used",
    { id: "d", name: "n", prefs: PREFS },
    async () => ({
      ok: false,
      json: async () => ({
        error: "DevicesError",
        message: "this pairing link was used or has expired",
      }),
    }),
  );
  expect(refused).toEqual({ error: "this pairing link was used or has expired" });
  for (const link of ["http://mini:4820/", "http://mini:4820/pair", "mini:4820/pair#x"])
    expect(
      await redeemPairing(link, { id: "d", name: "n", prefs: PREFS }, async () => ({
        ok: true,
        json: async () => ({}),
      })),
    ).toHaveProperty("error");
});
