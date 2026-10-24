import { AccountsError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { AppSidebar } from "./AppSidebar";

it("collapses to icons and remembers the choice", async () => {
  window.localStorage.removeItem("xtend:sidebar-open");
  await using screen = await render(
    <AppSidebar>
      <div>content</div>
    </AppSidebar>,
  );
  await expect.element(screen.getByText("Compose")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  await expect.element(screen.getByText("Compose")).not.toBeInTheDocument();
  expect(window.localStorage.getItem("xtend:sidebar-open")).toBe("false");

  await userEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
  await expect.element(screen.getByText("Compose")).toBeVisible();
});

it("says why the service refused an account switch instead of doing nothing", async () => {
  window.localStorage.removeItem("xtend:sidebar-open");
  await using screen = await render(
    <AppSidebar>
      <div>content</div>
    </AppSidebar>,
    {
      service: {
        "accounts.list": () =>
          Effect.succeed({
            accounts: [
              { id: 1, handle: "siamships", label: "Main", createdAt: "2026-10-01T00:00:00.000Z" },
              { id: 2, handle: null, label: "Brand", createdAt: "2026-10-02T00:00:00.000Z" },
            ],
            currentId: 1,
          }),
        "accounts.select": () =>
          Effect.fail(new AccountsError({ operation: "select", detail: "account 2 is gone" })),
        "spend.summary": () => Effect.never,
        "compose.draftsList": () => Effect.never,
      },
    },
  );
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Account" }), "Brand");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Accounts select failed: account 2 is gone");
  await expect.element(screen.getByRole("combobox", { name: "Account" })).toHaveValue("1");
});
