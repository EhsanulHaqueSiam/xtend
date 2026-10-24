import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, it } from "vite-plus/test";

import { checkRemote, readRemote, writeRemote } from "./remote.ts";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xtend-remote-"));
  const file = path.join(dir, "config.json");
  try {
    expect(readRemote(file)).toBeNull();
    writeRemote(file, { url: "http://mini.tail.ts.net:4820", token: "abc" });
    expect(readRemote(file)).toEqual({ url: "http://mini.tail.ts.net:4820", token: "abc" });
    // The token in it is the service's key; only this user may read it.
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    writeRemote(file, null);
    expect(readRemote(file)).toBeNull();
    for (const url of ["mini:4820", "ftp://mini:4820", "http://[mini"]) {
      fs.writeFileSync(file, JSON.stringify({ remote: { url, token: "abc" } }));
      expect(readRemote(file)).toBeNull();
    }
    fs.writeFileSync(file, "{ not json");
    expect(readRemote(file)).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
