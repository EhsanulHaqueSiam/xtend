import { RegistryProvider } from "@effect/atom-react";
import { SettingsError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { fakeServiceValues } from "../../../test/fakeService";
import { render } from "../../../test/render";
import { installFakeBridge } from "../../../test/fakeBridge";

installFakeBridge();
const { Reconnecting } = await import("../../routes/__root");
const { SettingsScreen } = await import("../../routes/settings");
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
  await using screen = await render(ui(false), { router: "/compose" });
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
  await userEvent.keyboard("{Tab}");
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Service settings" }));
  await expect.poll(() => screen.router?.state.location.href).toBe("/settings?tab=service");
  expect(screen.container.querySelector("[inert]")).toBeNull();
  await expect.element(notice).toBeVisible();
});

it("keeps the real service configuration usable when service reads fail", async () => {
  const setRemote = vi.fn();
  const checkRemote = vi
    .fn()
    .mockResolvedValue({ health: true, auth: true, version: "1", error: null });
  installFakeBridge({
    remote: { url: "http://mini:4820", token: "old-token" },
    setRemote,
    checkRemote,
  });
  await using screen = await render(
    <RegistryProvider
      initialValues={[
        ...fakeServiceValues({
          "settings.get": () =>
            Effect.fail(new SettingsError({ operation: "get", cause: "offline" })),
          "server.info": () => Effect.die("offline"),
        }),
        Atom.initialValue(connectionAtom, "disconnected"),
      ]}
    >
      <Reconnecting>
        <SettingsScreen />
      </Reconnecting>
    </RegistryProvider>,
    { router: "/settings?tab=service" },
  );
  await expect.element(screen.getByText("Could not load settings.")).toBeVisible();
  const inputs = screen.container.querySelectorAll("input");
  const token = Array.from(inputs).find((input) => input.type === "password");
  expect(token).toBeDefined();
  await userEvent.fill(page.elementLocator(token!), "new-token");
  await userEvent.click(screen.getByRole("button", { name: "Check", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Connect and relaunch" }));
  expect(setRemote).toHaveBeenCalledWith({ url: "http://mini:4820", token: "new-token" });
  await expect
    .element(screen.getByRole("status").filter({ hasText: "Service unreachable" }))
    .toBeVisible();
});
