import { expect, it } from "vite-plus/test";

import { checkRemote } from "./remote.ts";

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
