import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { AddressBar } from "../../routes/bar.address";
import { FindBar } from "../../routes/bar.find";

const calls = installFakeBridge({ kind: "bar", route: "/bar/find" });

it("find drives x.com as you type, Enter steps, Escape clears and closes", async () => {
  await using screen = await render(<FindBar />);
  await userEvent.type(screen.getByLabelText("Find in page"), "ab{Enter}");
  expect(calls.splice(0)).toEqual(["find a > false", "find ab > false", "find ab > true"]);
  await userEvent.keyboard("{Escape}");
  expect(calls.splice(0)).toEqual(["find stop", "close bar"]);
});

it("address navigates x.com on Enter and closes", async () => {
  await using screen = await render(<AddressBar />);
  const input = screen.getByLabelText("Session URL");
  await userEvent.clear(input);
  await userEvent.type(input, "i/bookmarks{Enter}");
  expect(calls.splice(0)).toEqual(["navigate https://x.com/i/bookmarks", "close bar"]);
});

it("address takes a URL typed without its scheme, as the placeholder shows it", async () => {
  await using screen = await render(<AddressBar />);
  const input = screen.getByLabelText("Session URL");
  await userEvent.clear(input);
  await userEvent.type(input, "x.com/levelsio{Enter}");
  await userEvent.clear(input);
  await userEvent.type(input, "https://x.com/i/bookmarks{Enter}");
  expect(calls.splice(0)).toEqual([
    "navigate https://x.com/levelsio",
    "close bar",
    "navigate https://x.com/i/bookmarks",
    "close bar",
  ]);
});
