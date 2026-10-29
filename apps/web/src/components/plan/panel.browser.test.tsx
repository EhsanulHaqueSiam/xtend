// Panel-width checks measure real layout, so the stylesheet loads. It stays out of the other
// plan tests: real styles cover the sr-only day checkboxes they click.
import "../../index.css";

import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { draft, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Queue } from "./Queue";
it("keeps a queued title whole beside the X panel, with the other actions in a menu", async () => {
  const container = document.createElement("div");
  container.style.width = "440px";
  const onSkip = vi.fn();
  await using screen = await render(
    <Queue
      drafts={[
        draft("q1", "queued", {
          blocks: [{ text: "Pricing lesson from this week" }],
          scheduledAt: "2030-01-07T09:30:00.000Z",
        }),
      ]}
      busy={false}
      emptyAction={null}
      onSkip={onSkip}
      onUnschedule={() => {}}
      onRunNow={() => {}}
      onOpen={() => {}}
    />,
    { container, service: { "costs.quote": quoting() } },
  );
  const title = screen.getByRole("button", { name: "Pricing lesson from this week" });
  await expect.element(title).toBeVisible();
  const el = title.element();
  expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
  // Priced before it can be clicked, and the button says the price.
  await expect.element(screen.getByRole("button", { name: /Post now \$/ })).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Skip this slot" }));
  expect(onSkip).toHaveBeenCalledWith("q1");
});
