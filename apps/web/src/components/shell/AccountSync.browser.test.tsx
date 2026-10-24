import { expect, it, onTestFinished } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { liveEvents } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { AccountSync } from "./AccountSync";

it("follows an account switch made in another client onto that account", async () => {
  // A desktop window on account 1.
  const calls = installFakeBridge();
  onTestFinished(() => {
    delete window.desktopBridge;
  });
  window.desktopBridge = {
    ...window.desktopBridge!,
    selectAccount: (id) => calls.push(`select ${id}`),
  };
  const events = liveEvents();
  await using _screen = await render(<AccountSync />, {
    service: { "events.subscribe": events.subscribe },
  });

  // This window's own switch echoing back is nothing to follow.
  events.emit("account_switched", { accountId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(calls).toEqual([]);

  // A browser tab switched to account 2: this window rebuilds on that account's session.
  events.emit("account_switched", { accountId: 2 });
  events.emit("spend_changed", {});
  await expect.poll(() => calls).toEqual(["select 2"]);
});
