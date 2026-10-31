import "../../index.css";
import { AccountsError, type Settings, type SpendSummary } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeEach, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { peoplePage, quoting } from "../../../test/fixtures";
import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";

// The shell reads the bridge at module load (env.ts), so it is imported after the bridge exists.
window.localStorage.removeItem("xtend:x-panel-open");
const bridge = installFakeBridge();
const { AppShell } = await import("./AppShell");
const { PageHeader } = await import("../PageHeader");
const { ShellHotkeys } = await import("./ShellHotkeys");

const settings = {
  handle: "siamships",
  tregTokenSet: false,
  assistProvider: "claude",
  assistBaseUrl: null,
  assistModel: "",
  assistBinaryPath: "",
  assistKeySet: false,
  monthlyBudgetUsd: 20,
  sessionPostingEnabled: false,
  dailyLibraryJobs: false,
  poolSharing: true,
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
  "costs.quote": quoting(),
  "leads.agentsList": () => Effect.succeed([]),
  "leads.peopleList": () => Effect.succeed(peoplePage()),
  "settings.get": () => Effect.succeed(settings),
  "spend.summary": () => Effect.succeed(spend),
  "compose.draftsList": () => Effect.succeed({ drafts: [] }),
  "engage.mentions": () => Effect.succeed({ mentions: [], apiError: null }),
  "plan.slotsGet": () => Effect.succeed({ slots: [] }),
  "automate.pendingList": () => Effect.succeed([]),
  "accounts.list": () => Effect.succeed({ accounts: [], currentId: 1 }),
} as const;

beforeEach(async () => {
  await page.viewport(1440, 920);
});

const shell = () => (
  <>
    <ShellHotkeys />
    <AppShell>
      <div className="flex h-full flex-col">
        <PageHeader title="Queue" />
      </div>
    </AppShell>
  </>
);

it("puts x.com over the main area on X's pages and beside the tools, from one webview", async () => {
  await using screen = await render(shell(), { router: "/compose", service });
  const pane = screen.getByRole("region", { name: "x.com", includeHidden: true });
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

it("opens routes sent from x.com beside it, and sends the Clean X defaults at start", async () => {
  window.localStorage.setItem("xtend:x-panel-open", "false");
  await using screen = await render(shell(), { router: "/x", service });
  const guest = screen.container.querySelector("webview");
  guest?.setAttribute("tabindex", "0");
  (guest as HTMLElement | null)?.focus();
  bridge.emitRoute("/scores?handle=jack");
  await expect.poll(() => screen.router?.state.location.pathname).toBe("/scores");
  await expect
    .element(screen.getByRole("region", { name: "x.com", includeHidden: true }))
    .toHaveAttribute("data-mode", "panel");
  await expect.element(screen.getByRole("main")).toHaveFocus();
  expect(bridge.calls).toContain("skin ads,grok,upsells,chrome,discover,boosts,extras");
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
  const account = screen.getByRole("button", { name: "Switch account" });
  await userEvent.click(account);
  await userEvent.click(page.getByRole("menuitem", { name: /^Brand/ }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Accounts select failed: account 2 is gone");
  await expect.element(account).toBeVisible();
});

it("offers show and hide X panel commands in the palette", async () => {
  await using screen = await render(shell(), { router: "/compose", service });
  const pane = screen.getByRole("region", { name: "x.com", includeHidden: true });
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(page.getByRole("option", { name: "Hide X panel" }));
  await expect.element(pane).toHaveAttribute("data-mode", "hidden");
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(page.getByRole("option", { name: "Show X panel" }));
  await expect.element(pane).toHaveAttribute("data-mode", "panel");
});

it("counts pending requests on Automate and Needs you", async () => {
  await using screen = await render(shell(), {
    router: "/automate",
    service: {
      ...service,
      "automate.pendingList": () =>
        Effect.succeed([
          {
            id: 1,
            ruleId: 1,
            ruleName: "Ask",
            subjectId: "20",
            description: "Like hello",
            status: "pending",
            createdAt: "2026-10-23T00:00:00Z",
            costUsd: 0.015,
          },
        ]),
    },
  });
  await expect
    .element(screen.getByRole("link", { name: /Automate\s*1/, exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: /Needs you\s*1/, exact: true }))
    .toBeVisible();
});

for (const savedWidth of [440, 760]) {
  it(`clamps a restored ${savedWidth}px panel on resize without changing the preference`, async () => {
    window.localStorage.setItem("xtend:x-panel-open", "true");
    window.localStorage.setItem("xtend:x-panel-width", String(savedWidth));
    const container = document.createElement("div");
    container.style.cssText = "width:900px;height:700px";
    await using screen = await render(shell(), { container, router: "/plan", service });
    const pane = screen.getByRole("region", { name: "x.com" });
    const width = (element: Element) => Math.round(element.getBoundingClientRect().width);
    await expect.poll(() => width(pane.element())).toBe(360);
    await expect.poll(() => width(screen.getByRole("main").element())).toBe(496);
    expect(width(screen.getByRole("complementary", { name: "Sidebar" }).element())).toBe(44);
    expect(
      screen.getByRole("button", { name: "Close X panel" }).element().getBoundingClientRect().right,
    ).toBeLessThanOrEqual(container.getBoundingClientRect().right);
    await userEvent.click(screen.getByRole("button", { name: "Plan sections" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Queue", exact: true }));
    expect(screen.router?.state.location.searchStr).toBe("?tab=queue");
    const guest = container.querySelector("webview");
    container.style.width = "1600px";
    await expect.poll(() => width(pane.element())).toBe(savedWidth);
    expect(container.querySelector("webview")).toBe(guest);
    expect(window.localStorage.getItem("xtend:x-panel-width")).toBe(String(savedWidth));
    container.style.width = "900px";
    await expect.poll(() => width(pane.element())).toBe(360);
  });
}

it("reopens X from the shared tool header and preserves its webview", async () => {
  window.localStorage.setItem("xtend:x-panel-open", "true");
  const container = document.createElement("div");
  container.style.cssText = "width:1440px;height:920px";
  await using screen = await render(shell(), { container, router: "/plan?tab=queue", service });
  const pane = screen.getByRole("region", { name: "x.com", includeHidden: true });
  const guest = container.querySelector("webview");
  await userEvent.click(screen.getByRole("button", { name: "Close X panel" }));
  const show = screen.getByRole("button", { name: "Show X panel" });
  await expect.element(show).toBeVisible();
  await expect.element(show).toHaveAttribute("title", "Show X panel (⌘\\)");
  await expect.element(show).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(show);
  await expect.element(pane).toHaveAttribute("data-mode", "panel");
  const hide = screen.getByRole("button", { name: "Hide X panel" });
  await expect.element(hide).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(hide);
  await expect.element(pane).toHaveAttribute("data-mode", "hidden");
  expect(container.querySelector("webview")).toBe(guest);
  expect(screen.router?.state.location.href).toBe("/plan?tab=queue");
});

it("moves the panel to each section's X page, hides it where X has none, and reloads only on a second click", async () => {
  window.localStorage.setItem("xtend:x-panel-open", "true");
  await using screen = await render(shell(), { router: "/compose", service });
  const pane = screen.getByRole("region", { name: "x.com", includeHidden: true });
  // A stand-in guest: each load lands, as did-navigate would report it.
  const loads: Array<string> = [];
  let reloads = 0;
  const guest = screen.container.querySelector("webview")!;
  const land = (url: string) =>
    guest.dispatchEvent(Object.assign(new Event("did-navigate"), { url, isMainFrame: true }));
  Object.assign(guest, {
    loadURL: async (url: string) => {
      loads.push(url);
      land(url);
    },
    reload: () => reloads++,
  });
  guest.dispatchEvent(new Event("dom-ready"));

  await expect.poll(() => loads.at(-1)).toBe("https://x.com/siamships");
  // A post opened beside Compose goes back to the profile on Plan, which shares that page.
  land("https://x.com/jack/status/1");
  await screen.router!.navigate({ href: "/plan" });
  await expect.poll(() => loads.at(-1)).toBe("https://x.com/siamships");
  expect(loads.filter((u) => u === "https://x.com/siamships")).toHaveLength(2);
  await screen.router!.navigate({ href: "/settings" });
  await expect.element(pane).toHaveAttribute("data-mode", "hidden");
  await screen.router!.navigate({ href: "/engage?tab=dms" });
  await expect.element(pane).toHaveAttribute("data-mode", "panel");
  await expect.poll(() => loads.at(-1)).toBe("https://x.com/messages");

  // Notifications shown beside a tool: the first click only brings it to the main area.
  await screen.router!.navigate({ href: "/engage?tab=inbox" });
  await expect.poll(() => loads.at(-1)).toBe("https://x.com/notifications");
  const count = loads.length;
  await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
  await expect.element(pane).toHaveAttribute("data-mode", "main");
  expect(loads.length).toBe(count);
  expect(reloads).toBe(0);
  await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(reloads).toBe(1);

  // Home is Xtend's own screen now: x.com stays out of sight under it.
  await userEvent.click(screen.getByRole("button", { name: "Home" }));
  await expect.poll(() => screen.router!.state.location.pathname).toBe("/home");
  await expect.element(pane).toHaveAttribute("data-mode", "hidden");
});
