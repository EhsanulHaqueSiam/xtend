import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { CommandPalette } from "./CommandPalette";
import { ShellHotkeys } from "./ShellHotkeys";

it("opens on ⌘K, filters commands and closes on Escape", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
  );
  expect(page.getByRole("dialog").query()).toBeNull();

  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await expect.element(page.getByText("Go to Compose")).toBeVisible();

  await userEvent.type(page.getByRole("textbox", { name: "Command" }), "pla");
  await expect.element(page.getByText("Go to Plan")).toBeVisible();
  expect(page.getByText("Go to Compose").query()).toBeNull();

  await userEvent.keyboard("{Escape}");
  expect(page.getByRole("dialog").query()).toBeNull();
  expect(screen.router?.state.location.pathname).toBe("/");
});
