import { AccountsError, type Settings, type SpendSummary } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";

// The shell reads the bridge at module load (env.ts), so it is imported after the bridge exists.
window.localStorage.removeItem("xtend:x-panel-open");
const bridge = installFakeBridge();
const { AppShell } = await import("./AppShell");
const { ShellHotkeys } = await import("./ShellHotkeys");

const settings = {
  handle: "siamships",
  tregTokenSet: false,
  monthlyBudgetUsd: 20,
  sessionPostingEnabled: false,
  dailyLibraryJobs: false,
  voiceNotes: "",
  keywords: [],
  timeZone: "UTC",
} satisfies Settings;
const spend = {
  monthUsd: 0,
  todayUsd: 0,
  monthlyBudgetUsd: 20,
  byPurpose: [],
  recent: [],
} satisfies SpendSummary;

const service = {
  "settings.get": () => Effect.succeed(settings),
  "spend.summary": () => Effect.succeed(spend),
  "compose.draftsList": () => Effect.succeed({ drafts: [] }),
  "engage.mentions": () => Effect.succeed({ mentions: [], apiError: null }),
  "plan.slotsGet": () => Effect.succeed({ slots: [] }),
  "accounts.list": () => Effect.succeed({ accounts: [], currentId: 1 }),
} as const;

const shell = () => (
  <>
    <ShellHotkeys />
    <AppShell>
      <div>page</div>
    </AppShell>
  </>
);

it("puts x.com over the main area on X's pages and beside the tools, from one webview", async () => {
  await using screen = await render(shell(), { router: "/compose", service });
  const pane = screen.getByRole("region", { name: "x.com" });
  await expect.element(pane).toHaveAttribute("data-mode", "panel");
  const webview = screen.container.querySelector("webview");
  expect(webview?.getAttribute("partition")).toBe("persist:x-session");
  expect(webview?.getAttribute("src")).toBe("https://x.com/home");

  await userEvent.keyboard("{Control>}\\{/Control}");
  await expect.element(pane).toHaveAttribute("data-mode", "hidden");
  expect(window.localStorage.getItem("xtend:x-panel-open")).toBe("false");

  await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(screen.router?.state.location.pathname).toBe("/x");
  await expect.element(pane).toHaveAttribute("data-mode", "main");

  // From X's pages, ⌘\ returns to the last tool with x.com docked beside it.
  await userEvent.keyboard("{Control>}\\{/Control}");
  expect(screen.router?.state.location.pathname).toBe("/compose");
  await expect.element(pane).toHaveAttribute("data-mode", "panel");
  // Moving between the main area and the panel never rebuilt the session.
  expect(screen.container.querySelector("webview")).toBe(webview);
});

it("opens routes sent from x.com beside it, and turns the skin on at start", async () => {
  window.localStorage.setItem("xtend:x-panel-open", "false");
  await using screen = await render(shell(), { router: "/x", service });
  bridge.emitRoute("/scores?handle=jack");
  await expect.poll(() => screen.router?.state.location.pathname).toBe("/scores");
  await expect
    .element(screen.getByRole("region", { name: "x.com" }))
    .toHaveAttribute("data-mode", "panel");
  expect(bridge.calls).toContain("skin true");
});

it("opens the palette on ⌘K sent from inside x.com", async () => {
  await using screen = await render(shell(), { router: "/x", service });
  bridge.emitShortcut("palette");
  const palette = screen.getByRole("dialog", { name: "Command palette" });
  await expect.element(palette).toBeVisible();
  await expect.element(palette.getByRole("option", { name: "Notifications" })).toBeVisible();
});

it("says why the service refused an account switch instead of doing nothing", async () => {
  await using screen = await render(shell(), {
    router: "/compose",
    service: {
      ...service,
      "accounts.list": () =>
        Effect.succeed({
          accounts: [
            { id: 1, handle: "siamships", label: "Main", createdAt: "2026-10-01T00:00:00.000Z" },
            { id: 2, handle: null, label: "Brand", createdAt: "2026-10-02T00:00:00.000Z" },
          ],
          currentId: 1,
        }),
      "accounts.select": () =>
        Effect.fail(new AccountsError({ operation: "select", detail: "account 2 is gone" })),
    },
  });
  const account = screen.getByRole("button", { name: "@siamships" });
  await userEvent.click(account);
  await userEvent.click(page.getByRole("menuitem", { name: /^Brand/ }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Accounts select failed: account 2 is gone");
  await expect.element(account).toBeVisible();
});
