import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { HeaderTabs, PageHeader } from "./PageHeader";

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

it("keeps every action in view at a 496px tool, wrapping rather than clipping (Analyze › Competitors)", async () => {
  const container = document.createElement("div");
  container.style.width = "496px";
  await using screen = await render(
    <PageHeader
      title="Competitors"
      tabs={
        <HeaderTabs
          label="Window"
          value="7"
          onChange={() => {}}
          tabs={[
            { id: "7", label: "7 days" },
            { id: "30", label: "30 days" },
          ]}
        />
      }
      detail="fetched Oct 28, 07:00 AM · 100 posts"
      actions={
        <>
          <form className="flex items-center gap-1.5">
            <input aria-label="Handle to watch" className="w-36" />
            <button type="submit">Watch free</button>
          </form>
          <button type="button">Profile on X free</button>
          <button type="button">Refresh posts $0.00397</button>
        </>
      }
    />,
    { container, router: "/analyze?tab=competitors" },
  );
  await expect.element(screen.getByRole("textbox", { name: "Handle to watch" })).toBeVisible();
  const bounds = container.getBoundingClientRect();
  for (const control of [
    screen.getByRole("textbox", { name: "Handle to watch" }),
    screen.getByRole("button", { name: "Watch free" }),
    screen.getByRole("button", { name: "Profile on X free" }),
    screen.getByRole("button", { name: "Refresh posts $0.00397" }),
  ]) {
    expect(control.element().checkVisibility()).toBe(true);
    const box = control.element().getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(bounds.left);
    expect(box.right).toBeLessThanOrEqual(bounds.right);
  }
});
