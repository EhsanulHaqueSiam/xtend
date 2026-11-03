import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render, stubGlobal } from "../../../test/render";
import { savedService } from "../../rpc/client";
import { Connect } from "./Connect";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

it("puts each problem under its field, then remembers the service a pairing link joined", async () => {
  const codes: Array<string> = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://mini.ts.net/api/health")
      return json({ name: "xtend", version: "0.0.4", supervisor: "launchd" });
    if (url === "https://mini.ts.net/api/pair") {
      const { code } = JSON.parse(String(init?.body)) as { code: string };
      codes.push(code);
      return code === "fresh"
        ? json({ token: "device-token" })
        : json({ message: "this pairing link was used or has expired; make a new one" }, 403);
    }
    throw new TypeError("Failed to fetch");
  });
  using _fetch = stubGlobal("fetch", fetch);
  onTestFinished(() => window.localStorage.clear());
  await using screen = await render(<Connect secure />, { router: false });
  const address = screen.getByPlaceholder("https://mini.tail1a2b3.ts.net");
  const link = screen.getByPlaceholder("https://…/pair#code");
  const submit = screen.getByRole("button", { name: /Connect|Try again/ });
  const alert = () => page.getByRole("alert").query()?.textContent ?? "";

  // An https page cannot reach a plain http service on another host, so nothing is fetched.
  await userEvent.fill(address, "http://100.88.12.7:4820");
  await userEvent.fill(link, "http://100.88.12.7:4820/pair#used");
  await userEvent.click(submit);
  await expect.poll(alert).toContain("tailscale serve --bg 4820");
  expect(fetch).not.toHaveBeenCalled();

  // A scheme-less address is read as https; the link's code goes to that address, not the link's host.
  await userEvent.fill(address, "mini.ts.net");
  await userEvent.click(submit);
  await expect.poll(alert).toContain("used or has expired");
  await expect.element(screen.getByText("Service found, 0.0.4", { exact: false })).toBeVisible();

  await userEvent.fill(link, "http://100.88.12.7:4820/pair#fresh");
  await userEvent.click(submit);
  await expect.element(screen.getByRole("heading", { name: "Connected" })).toBeVisible();
  expect(codes).toEqual(["used", "fresh"]);
  expect(savedService()).toEqual({ url: "https://mini.ts.net", token: "device-token" });
});
