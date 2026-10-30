import { useLocation } from "@tanstack/react-router";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";

installFakeBridge();
const { ShellHotkeys } = await import("./ShellHotkeys");

it.each([
  ["c", "/compose?new=1"],
  ["p", "/plan"],
  ["a", "/analyze"],
  ["e", "/engage"],
  ["l", "/library"],
  ["s", "/library?tab=search"],
  ["x", "/x"],
])("routes %s outside an input to %s", async (key, href) => {
  await using screen = await render(<ShellHotkeys />);
  await userEvent.keyboard(key);
  await expect.poll(() => screen.router?.state.location.href).toBe(href);
});

it("leaves handled keys and typing to the screen", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <button onKeyDown={(event) => event.preventDefault()}>Approve</button>
      <input aria-label="Editor" />
    </>,
  );
  await userEvent.click(page.getByRole("button", { name: "Approve" }));
  await userEvent.keyboard("a");
  expect(screen.router?.state.location.href).toBe("/");
  await userEvent.type(page.getByRole("textbox", { name: "Editor" }), "cpas");
  expect(screen.router?.state.location.href).toBe("/");
});

function SearchScreen() {
  const location = useLocation();
  return location.pathname === "/library" &&
    new URLSearchParams(location.searchStr).get("tab") === "search" ? (
    <input data-shortcut="search" aria-label="Search X" />
  ) : null;
}

it("opens Library Search and focuses its query, including when already open", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <SearchScreen />
      <button>Other</button>
    </>,
  );
  const focusSearch = async () => {
    await userEvent.click(page.getByRole("button", { name: "Other" }));
    await userEvent.keyboard("s");
    await expect.poll(() => screen.router?.state.location.href).toBe("/library?tab=search");
    await expect.element(page.getByRole("textbox", { name: "Search X" })).toHaveFocus();
  };
  await focusSearch();
  await focusSearch();
});

it("focuses an open search without discarding its query", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <SearchScreen />
      <button>Other</button>
    </>,
    { router: "/library?tab=search&q=founders" },
  );
  await userEvent.click(page.getByRole("button", { name: "Other" }));
  await userEvent.keyboard("s");
  await expect.element(page.getByRole("textbox", { name: "Search X" })).toHaveFocus();
  expect(screen.router?.state.location.href).toBe("/library?tab=search&q=founders");
});
