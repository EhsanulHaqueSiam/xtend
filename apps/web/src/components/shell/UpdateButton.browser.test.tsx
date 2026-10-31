import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { Sidebar } from "./Sidebar";

it("checks for updates when idle, restarts into a ready build, and says once that this launch is new", async () => {
  localStorage.setItem("xtend:seen-version", "0.0.2");
  const idle = installFakeBridge({
    getUpdate: () => Promise.resolve({ channel: "stable", version: "0.0.2", status: "idle" }),
  });
  {
    await using screen = await render(<Sidebar />, { service: {} });
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(idle.calls).toContain("update check");
  }

  const ready = installFakeBridge({
    getUpdate: () =>
      Promise.resolve({ channel: "stable", version: "0.0.2", status: "ready", next: "0.0.3" }),
  });
  {
    await using screen = await render(<Sidebar />, { service: {} });
    await userEvent.click(screen.getByRole("button", { name: "Restart to update to 0.0.3" }));
    expect(ready.calls).toContain("update restart");
  }

  // The first launch on 0.0.3 after running 0.0.2.
  installFakeBridge({
    getUpdate: () => Promise.resolve({ channel: "stable", version: "0.0.3", status: "idle" }),
  });
  await using screen = await render(<Sidebar />, { service: {} });
  await userEvent.click(screen.getByRole("button", { name: /Updated/ }));
  await expect.element(screen.getByRole("button", { name: "Check for updates" })).toBeVisible();
});
