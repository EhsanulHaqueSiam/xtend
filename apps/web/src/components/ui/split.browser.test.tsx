import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Menu, MenuItem } from "./menu";
import { Popover } from "./popover";
import { DetailSplit, ListRow, useSelection } from "./split";

function Triage({ name }: { readonly name: string }) {
  const [ids, setIds] = useState(["A", "B", "C"]);
  const { selected, select } = useSelection(ids);
  return (
    <DetailSplit
      list={
        <>
          {ids.map((id) => (
            <ListRow
              key={id}
              item={id}
              columns={[]}
              selected={selected === id}
              onSelect={() => select(id)}
            >
              {name} {id}
            </ListRow>
          ))}
        </>
      }
      detail={
        <button onClick={() => setIds(ids.filter((id) => id !== selected))}>
          Handle {name} {selected}
        </button>
      }
    />
  );
}

it("moves focus with j/k and arrows within the focused list, so Enter activates its selection", async () => {
  await using screen = await render(
    <>
      <Triage name="First" />
      <Triage name="Second" />
    </>,
    { router: false },
  );
  await userEvent.click(screen.getByRole("button", { name: "First A", exact: true }));
  await userEvent.keyboard("j{Enter}");
  await expect.element(screen.getByRole("button", { name: "First B", exact: true })).toHaveFocus();
  await expect.element(screen.getByRole("button", { name: "Handle First B" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Handle Second A" })).toBeVisible();
  await userEvent.keyboard("{ArrowDown}k{ArrowUp}");
  await expect.element(screen.getByRole("button", { name: "First A", exact: true })).toHaveFocus();
});

it("restores focus to the next selected row when the selected item is removed", async () => {
  await using screen = await render(<Triage name="Inbox" />, { router: false });
  await userEvent.click(screen.getByRole("button", { name: "Inbox B", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Handle Inbox B" }));
  await expect.element(screen.getByRole("button", { name: "Inbox C", exact: true })).toHaveFocus();
});

function Closable() {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState(false);
  return (
    <DetailSplit
      closable
      onClose={() => setOpen(false)}
      list={<button onClick={() => setOpen(true)}>Open detail</button>}
      detail={
        open ? (
          <div>
            <button>Detail action</button>
            <input aria-label="Editor" />
            <Menu trigger={<button>Menu</button>}>
              <MenuItem onClick={() => {}}>Item</MenuItem>
            </Menu>
            <Popover trigger={<button>Popover</button>} open={popup} onOpenChange={setPopup}>
              <button>Popup action</button>
            </Popover>
          </div>
        ) : null
      }
    />
  );
}

it("closes a detail on Escape and restores its opener, respecting editors and popups", async () => {
  await using screen = await render(<Closable />, { router: false });
  await userEvent.click(screen.getByRole("button", { name: "Open detail" }));
  await userEvent.click(screen.getByRole("textbox", { name: "Editor" }));
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Detail action" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Menu", exact: true }));
  await expect.element(page.getByRole("menuitem", { name: "Item" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Detail action" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Popover", exact: true }));
  await expect.element(page.getByRole("button", { name: "Popup action" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Detail action" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Detail action" }));
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Detail action" }).query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Open detail" })).toHaveFocus();
});

function Autofocusing() {
  const [open, setOpen] = useState(false);
  return (
    <DetailSplit
      onClose={() => setOpen(false)}
      list={<button onClick={() => setOpen(true)}>Open detail</button>}
      detail={
        open ? (
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the case under test: a detail that takes focus on mount.
          <button autoFocus>First field</button>
        ) : null
      }
    />
  );
}

it("returns focus to what opened a detail that focused its own first control", async () => {
  await using screen = await render(<Autofocusing />, { router: false });
  await userEvent.click(screen.getByRole("button", { name: "Open detail" }));
  await expect.element(screen.getByRole("button", { name: "First field" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("button", { name: "Open detail" })).toHaveFocus();
});
