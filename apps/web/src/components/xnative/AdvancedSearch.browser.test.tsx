import { expect, it } from "vite-plus/test";
import { type Locator, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AdvancedSearch } from "./AdvancedSearch";

// Tests load no CSS, so Base UI's backdrop covers the unstyled form: clicks go to the element.
const press = (control: Locator) => {
  const element = control.element();
  if (element instanceof HTMLElement) element.click();
};

it("starts from the open search and hands back the operators X's form writes", async () => {
  const searched: Array<string> = [];
  await using _screen = await render(
    <AdvancedSearch
      open
      query="cats -filter:replies min_faves:100"
      onClose={() => {}}
      onSearch={(q) => searched.push(q)}
    />,
    { service: {} },
  );
  const dialog = page.getByRole("dialog", { name: "Advanced search" });
  await expect
    .element(dialog.getByRole("textbox", { name: "All of these words" }))
    .toHaveValue("cats");
  await expect.element(dialog.getByRole("textbox", { name: "Minimum Likes" })).toHaveValue("100");
  // Replies left out: the switch is off and its two choices are hidden.
  await expect.element(dialog.getByRole("switch", { name: "Replies" })).not.toBeChecked();
  expect(dialog.getByRole("radio", { name: "Only show replies" }).elements()).toHaveLength(0);

  press(dialog.getByRole("switch", { name: "Replies" }));
  await expect.element(dialog.getByRole("radio", { name: "Only show replies" })).toBeVisible();
  press(dialog.getByRole("radio", { name: "Only show replies" }));
  await userEvent.fill(dialog.getByRole("textbox", { name: "From these accounts" }), "@alice");
  await userEvent.fill(dialog.getByRole("textbox", { name: "Minimum reposts" }), "1k5");
  press(dialog.getByRole("button", { name: "Search" }));
  expect(searched).toEqual(["cats from:alice min_faves:100 min_retweets:15 filter:replies"]);
});
