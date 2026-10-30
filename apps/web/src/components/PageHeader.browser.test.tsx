import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { PageHeader } from "./PageHeader";

it("explains the tool and its open section on a first visit, and stays closed once closed", async () => {
  localStorage.removeItem("xtend:about-closed");
  await using screen = await render(<PageHeader title="Calendar" />, {
    router: "/plan?tab=calendar",
  });
  const tool = screen.getByText(/When your posts go out/);
  await expect.element(tool).toBeVisible();
  await expect.element(screen.getByText(/Drop a draft on a slot/)).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await expect.element(tool).not.toBeInTheDocument();
  expect(localStorage.getItem("xtend:about-closed")).toBe("/plan");

  // The ⓘ brings it back.
  await userEvent.click(screen.getByRole("button", { name: "About Plan" }));
  await expect.element(screen.getByText(/When your posts go out/)).toBeVisible();
});

it("does not offer an X panel in a browser", async () => {
  await using screen = await render(<PageHeader title="Calendar" />, { router: "/plan" });
  await expect
    .element(screen.getByRole("button", { name: /^(Show|Hide) X panel$/ }))
    .not.toBeInTheDocument();
});
