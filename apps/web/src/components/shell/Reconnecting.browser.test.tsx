import { RegistryProvider } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { fakeServiceValues } from "../../../test/fakeService";
import { render } from "../../../test/render";
import { Reconnecting } from "../../routes/__root";
import { connectionAtom } from "../../state/shell";

it("makes disconnected controls inert and moves focus to the recovery notice", async () => {
  const action = vi.fn();
  const ui = (down: boolean) => (
    <RegistryProvider
      key={String(down)}
      initialValues={[
        ...fakeServiceValues({}),
        Atom.initialValue(connectionAtom, down ? "disconnected" : "connected"),
      ]}
    >
      <Reconnecting>
        <button onClick={action}>Paid action</button>
      </Reconnecting>
    </RegistryProvider>
  );
  await using screen = await render(ui(false), { router: false });
  await userEvent.click(page.getByRole("button", { name: "Paid action" }));
  action.mockClear();
  await screen.rerender(ui(true));
  const notice = page.getByRole("status");
  await expect.element(notice).toHaveFocus();
  expect(
    screen.container
      .querySelector("[inert]")
      ?.contains(page.getByRole("button", { name: "Paid action" }).element()),
  ).toBe(true);
  await userEvent.keyboard("{Tab}{Enter}");
  expect(action).not.toHaveBeenCalled();
});
