import {
  AccountsError,
  SettingsError,
  type AccountList,
  type Settings,
  type SettingsUpdate,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../test/fakeBridge";
import type { FakeService } from "../../test/fakeService";
import { paid, quoting, settings } from "../../test/fixtures";
import { render } from "../../test/render";
import { NOT_A_HANDLE } from "../lib/utils";
import { SettingsScreen } from "../routes/settings";

const accounts: AccountList = {
  accounts: [
    { id: 1, handle: "siamships", label: "Main", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: 2, handle: "sidebrand", label: "Brand", createdAt: "2026-10-02T00:00:00.000Z" },
  ],
  currentId: 1,
};

/** A settings service that applies updates, so what the screen reads back is what it saved. */
const service = (
  updates: Array<SettingsUpdate>,
  refuseUpdate = () => false,
  extra: FakeService = {},
): FakeService => {
  let current: Settings = settings;
  return {
    "server.info": () =>
      Effect.succeed({
        name: "xtend",
        version: "0.1.0",
        baseDir: "/tmp/xtend-test",
        host: "127.0.0.1",
        supervisor: "none",
      }),
    "accounts.list": () => Effect.succeed(accounts),
    "settings.get": () => Effect.sync(() => current),
    "settings.update": (patch) =>
      refuseUpdate()
        ? Effect.fail(new SettingsError({ operation: "update", cause: null }))
        : Effect.sync(() => {
            updates.push(patch);
            current = {
              ...current,
              handle: patch.handle === undefined ? current.handle : patch.handle,
              monthlyBudgetUsd: patch.monthlyBudgetUsd ?? current.monthlyBudgetUsd,
              timeZone: patch.timeZone ?? current.timeZone,
              tregTokenSet: current.tregTokenSet || typeof patch.tregToken === "string",
            };
            return current;
          }),
    "spend.summary": () =>
      Effect.sync(() => ({
        monthUsd: 1.5,
        todayUsd: 0.25,
        monthlyBudgetUsd: current.monthlyBudgetUsd,
        byPurpose: [],
        recent: [],
      })),
    ...extra,
  };
};

it("saves a budget only once it is valid, and the meter shows the new budget", async () => {
  const updates: Array<SettingsUpdate> = [];
  await using screen = await render(<SettingsScreen />, {
    service: service(updates),
    router: "/settings?tab=money",
  });
  // The meter's budget, beside this month's $1.50.
  await expect.element(screen.getByText("$20.00", { exact: true })).toBeVisible();
  const budget = screen.getByRole("spinbutton");

  // Empty is not $0: a cleared field would otherwise stop every paid call.
  await userEvent.clear(budget);
  await expect.element(screen.getByText("Enter an amount of 0 or more.")).toBeVisible();
  const save = screen.getByRole("button", { name: "Save" });
  await expect.element(save).toBeDisabled();
  await userEvent.type(budget, "35.5");
  await expect.element(save).toBeEnabled();
  await userEvent.click(save);

  await expect.poll(() => updates).toEqual([{ monthlyBudgetUsd: 35.5 }]);
  await expect.element(screen.getByText("$35.50", { exact: true })).toBeVisible();
});

it("saves a time zone only once Intl knows it", async () => {
  const updates: Array<SettingsUpdate> = [];
  await using screen = await render(<SettingsScreen />, {
    service: service(updates),
    router: "/settings?tab=writing",
  });
  const zone = screen.getByLabelText(/^Time zone/);
  await userEvent.fill(zone, "Asia/Dhak");
  await expect.element(screen.getByText("Not a time zone. Pick one from the list.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.fill(zone, "Asia/Dhaka");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => updates).toEqual([{ timeZone: "Asia/Dhaka" }]);
});

it("runs assist on the Codex login with a chosen model, and keeps the endpoint fields away", async () => {
  const updates: Array<SettingsUpdate> = [];
  await using screen = await render(<SettingsScreen />, {
    service: service(updates),
    router: "/settings?tab=writing",
  });
  await expect
    .element(screen.getByRole("button", { name: "Claude" }))
    .toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Codex" }));
  await userEvent.fill(screen.getByPlaceholder("default"), "m1");
  await expect.element(screen.getByText("Endpoint", { exact: true })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => updates).toEqual([{ assistProvider: "codex", assistModel: "m1" }]);
});

it("requotes after a saved keyword change, so the daily jobs show the new search price", async () => {
  // The picks price is one search per keyword, read from the saved settings.
  let keywords: ReadonlyArray<string> = ["ai"];
  await using screen = await render(<SettingsScreen />, {
    service: service([], () => false, {
      "settings.get": () => Effect.sync(() => ({ ...settings, keywords })),
      "settings.update": (patch) =>
        Effect.sync(() => {
          keywords = patch.keywords ?? keywords;
          return { ...settings, keywords };
        }),
      "costs.quote": quoting((a) => paid(a.kind === "picksFetch" ? 0.005 * keywords.length : 0)),
    }),
    router: "/settings?tab=writing",
  });
  await expect.element(screen.getByText(/\(\$0\.005 in searches\)/)).toBeVisible();
  // Assist runs on the user's own login, so its $0 quote reads as free.
  await expect.element(screen.getByText(/written on your login/)).toBeVisible();
  await userEvent.fill(screen.getByLabelText(/^Keywords/), "ai, agents");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.element(screen.getByText(/\(\$0\.01 in searches\)/)).toBeVisible();
});

it("finds a row on another page by its label and shows the page as a crumb", async () => {
  await using screen = await render(<SettingsScreen />, { service: service([]) });
  await expect.element(screen.getByPlaceholder("handle without @")).toBeVisible();
  await userEvent.fill(screen.getByRole("searchbox", { name: "Search settings" }), "budget");
  await expect.element(screen.getByRole("spinbutton")).toBeVisible();
  await expect.element(screen.getByText("Money", { exact: true })).toBeVisible();
  await expect.element(screen.getByPlaceholder("handle without @")).not.toBeInTheDocument();
});

it("restores a page's defaults only after a second click", async () => {
  const updates: Array<SettingsUpdate> = [];
  await using screen = await render(<SettingsScreen />, {
    service: service(updates),
    router: "/settings?tab=pool",
  });
  const restore = screen.getByRole("button", { name: "Restore defaults" });
  await userEvent.click(restore);
  expect(updates).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
  await expect.poll(() => updates).toEqual([{ poolSharing: true }]);
});

it("saves a handle as X spells it and refuses one X would not accept", async () => {
  const updates: Array<SettingsUpdate> = [];
  await using screen = await render(<SettingsScreen />, { service: service(updates) });
  const handle = screen.getByPlaceholder("handle without @");
  await userEvent.fill(handle, "two words");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.element(screen.getByRole("alert")).toHaveTextContent(NOT_A_HANDLE);
  expect(updates).toEqual([]);

  await userEvent.fill(handle, " @NewHandle ");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => updates).toEqual([{ handle: "NewHandle" }]);
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

it("stores a treg token without showing it again, and says why a save failed", async () => {
  const updates: Array<SettingsUpdate> = [];
  let refuse = false;
  await using screen = await render(<SettingsScreen />, {
    service: service(updates, () => refuse),
    router: "/settings?tab=money",
  });
  await userEvent.fill(screen.getByPlaceholder("treg token"), "tk_live_123");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.poll(() => updates).toEqual([{ tregToken: "tk_live_123" }]);
  // The token never shows again; the field empties and the hint says one is stored.
  await expect.element(screen.getByPlaceholder("treg token")).toHaveValue("");

  refuse = true;
  await userEvent.fill(screen.getByPlaceholder("treg token"), "tk_live_456");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Settings failed during update.");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("switches account only after the service selected it, and says when it refused", async () => {
  const { calls } = installFakeBridge();
  onTestFinished(() => {
    delete window.desktopBridge;
  });
  window.desktopBridge = {
    ...window.desktopBridge!,
    selectAccount: (id) => calls.push(`select ${id}`),
  };
  let refuse = true;
  const selected: Array<number> = [];
  await using screen = await render(<SettingsScreen />, {
    service: service([], undefined, {
      "accounts.select": ({ id }) =>
        refuse
          ? Effect.fail(new AccountsError({ operation: "select", detail: "no such account" }))
          : Effect.sync(() => {
              selected.push(id);
              return { ...accounts, currentId: id };
            }),
    }),
  });
  await userEvent.click(screen.getByRole("button", { name: "Switch" }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Accounts select failed: no such account");
  expect(calls).toEqual([]);

  refuse = false;
  await userEvent.click(screen.getByRole("button", { name: "Switch" }));
  await expect.poll(() => calls).toEqual(["select 2"]);
  expect(selected).toEqual([2]);
});
