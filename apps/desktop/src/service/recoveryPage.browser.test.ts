import { afterEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { failureReason, recoveryPage } from "./recoveryPage.ts";

const FAILED_AT = Date.parse("2026-10-31T12:00:00.000Z");

let frame: HTMLIFrameElement | undefined;
afterEach(() => frame?.remove());

function mount(remote: { url: string; token: string } | null) {
  frame = document.createElement("iframe");
  frame.style.cssText = "border:0;width:900px;height:700px";
  document.body.append(frame);
  const bridge = {
    remote,
    serviceToken: "local-token",
    retryService: vi.fn(),
    setRemote: vi.fn(),
    checkRemote: vi.fn().mockResolvedValue({ health: true, auth: true, error: null }),
  };
  const win = frame.contentWindow!;
  Reflect.set(win, "desktopBridge", bridge);
  // The page's own script reads the frame's clock: twelve seconds after the failure.
  vi.spyOn((win as Window & typeof globalThis).Date, "now").mockReturnValue(FAILED_AT + 12_000);
  const doc = win.document;
  doc.open();
  doc.write(
    recoveryPage(remote?.url ?? "http://127.0.0.1:4820", {
      reason: failureReason("ERR_CONNECTION_REFUSED"),
      at: FAILED_AT,
    }),
  );
  doc.close();
  return { bridge, doc };
}

it("recovers a local service without the web app or a running service", async () => {
  const { bridge, doc } = mount(null);
  const ui = page.frameLocator(page.elementLocator(frame!));
  await expect.element(ui.getByRole("heading", { name: "Can't reach the service" })).toBeVisible();
  // What failed and when, as the mock reads: no scheme, Chromium's error in words, elapsed time.
  await expect.element(ui.getByText("127.0.0.1:4820 · connection refused · 12s ago")).toBeVisible();
  expect((doc.querySelector('[name="url"]') as HTMLInputElement).value).toBe(
    "http://127.0.0.1:4820",
  );
  await userEvent.click(ui.getByRole("button", { name: "Retry", exact: true }));
  expect(bridge.retryService).toHaveBeenCalledOnce();
  await userEvent.click(ui.getByRole("button", { name: "Use local service" }));
  expect(bridge.setRemote).toHaveBeenCalledWith(null);
});

it("checks edited remote credentials before saving and relaunching, and reports a refused token", async () => {
  const { bridge, doc } = mount({ url: "http://192.0.2.10:4820", token: "old" });
  const ui = page.frameLocator(page.elementLocator(frame!));
  // Password controls have no implicit textbox role.
  await userEvent.fill(ui.getByLabelText("Service URL"), "http://mini:4820");
  await userEvent.fill(ui.getByLabelText("Service token"), "new-token");
  expect(doc.querySelector('[name="token"]')?.getAttribute("type")).toBe("password");
  bridge.checkRemote.mockResolvedValueOnce({
    health: true,
    auth: false,
    error: "the service refused the token",
  });
  await userEvent.click(ui.getByRole("button", { name: "Connect and relaunch" }));
  await expect.element(ui.getByRole("status")).toHaveTextContent("the service refused the token");
  expect(bridge.setRemote).not.toHaveBeenCalled();
  await userEvent.click(ui.getByRole("button", { name: "Connect and relaunch" }));
  await expect
    .poll(() => bridge.setRemote.mock.calls)
    .toEqual([[{ url: "http://mini:4820", token: "new-token" }]]);
});
