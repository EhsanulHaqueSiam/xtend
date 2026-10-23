import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { ShellHotkeys } from "./ShellHotkeys";
import { SlotShell } from "./SlotShell";

// Before the first render: the slot atom reads the bridge once and keeps it.
const calls = installFakeBridge({ kind: "center", route: "/plan" });

it("frames center pages with X's tabs; tabs, More and the back arrow go through main", async () => {
  await using screen = await render(
    <SlotShell>
      <div>content</div>
    </SlotShell>,
    { router: "/plan" },
  );
  await expect.element(screen.getByText("content")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Plan" }))
    .toHaveAttribute("aria-current", "page");
  await userEvent.click(screen.getByRole("button", { name: "Library" }));
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Settings" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(calls.splice(0)).toEqual([
    "open center /library",
    "open center /settings",
    "close center",
  ]);
});

it("in a slot, Esc closes it and ⌘K and letters ask main for slots", async () => {
  await using screen = await render(<ShellHotkeys />);
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.keyboard("c");
  expect(calls.splice(0)).toEqual(["close *", "open palette /palette", "open center /compose"]);
  expect(screen.router?.state.location.pathname).toBe("/");
});
