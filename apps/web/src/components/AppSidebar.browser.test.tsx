import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { AppSidebar } from "./AppSidebar";

it("collapses to icons and remembers the choice", async () => {
  window.localStorage.removeItem("corvid:sidebar-open");
  await using screen = await render(
    <AppSidebar>
      <div>content</div>
    </AppSidebar>,
  );
  await expect.element(screen.getByText("Compose")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  await expect.element(screen.getByText("Compose")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("corvid:sidebar-open")).toBe("false");

  await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  await expect.element(screen.getByText("Compose")).toBeVisible();
});
