import "../../index.css";
import { useAtomValue } from "@effect/atom-react";
import { LeadsError, type SignalAgent } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { peoplePage, quoting, settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { runAgentAtom } from "../../state/leads";
import { Toasts } from "../ui/toast";
import { CommandPalette } from "./CommandPalette";
import { ShellHotkeys } from "./ShellHotkeys";

it("opens on ⌘K, filters commands and closes on Escape", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([]),
      },
    },
  );
  await expect.poll(() => page.getByRole("dialog").query()).toBeNull();

  await userEvent.keyboard("{Meta>}k{/Meta}");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect.element(palette).toBeVisible();
  await expect.element(palette.getByRole("option", { name: "Compose" })).toBeVisible();

  await userEvent.type(page.getByRole("textbox", { name: "Command" }), "pla");
  await expect.element(palette.getByRole("option", { name: "Plan", exact: true })).toBeVisible();
  expect(palette.getByRole("option", { name: "Compose" }).query()).toBeNull();

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => page.getByRole("dialog").query()).toBeNull();
  expect(screen.router?.state.location.pathname).toBe("/");
});

const agent: SignalAgent = {
  id: 4,
  name: "founders",
  query: "saas founder",
  minFollowers: 0,
  intervalMinutes: 30,
  enabled: true,
  scoringPrompt: "",
  lang: null,
  excludeBots: true,
  notifyMinScore: null,
  listId: null,
  lastRun: null,
};

it("arrows and Enter run the highlighted command; @handle offers its report; agents show their price", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([agent]),
      },
    },
  );
  // Typing a command letter in the palette's box filters; it never navigates.
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(page.getByText("paid run up to $0.01175 + $0.001")).toBeVisible();
  const box = page.getByRole("textbox", { name: "Command" });
  await userEvent.type(box, "a");
  expect(screen.router?.state.location.pathname).toBe("/");
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("option", { selected: true })).toHaveTextContent("Plan");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => screen.router?.state.location.pathname).toBe("/plan");
  await expect.poll(() => page.getByRole("dialog").query()).toBeNull();

  await userEvent.keyboard("{Meta>}k{/Meta}");
  const command = page.getByRole("textbox", { name: "Command" });
  await userEvent.type(command, "@a_handle_longer_than_15");
  expect(page.getByText(/^Report on/).query()).toBeNull();
  await userEvent.clear(command);
  await userEvent.type(command, "@levelsio");
  await expect
    .element(page.getByRole("option", { selected: true }))
    .toHaveTextContent("Report on @levelsio");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => screen.router?.state.location.href).toBe("/scores?handle=levelsio");
});

function AgentRunStatus() {
  const state = useAtomValue(runAgentAtom);
  return <output aria-label="Shared run">{state.waiting ? "running" : "idle"}</output>;
}

it("an agent run started from the palette finishes after the palette closes", async () => {
  let release = () => {};
  const searched = new Promise<void>((resolve) => (release = resolve));
  const payloads: Array<{ readonly id: number }> = [];
  let started = false;
  let finished = false;
  await using _screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
      <AgentRunStatus />
      <Toasts />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([agent]),
        "leads.agentRun": ({ id }) =>
          Effect.promise(() => {
            payloads.push({ id });
            started = true;
            return searched;
          }).pipe(
            Effect.map(() => {
              finished = true;
              return {
                id: 1,
                agentId: id,
                at: "2026-10-23T09:00:00.000Z",
                found: 3,
                inserted: 2,
                costUsd: 0.00075,
                error: null,
              };
            }),
          ),
      },
    },
  );
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.type(page.getByRole("textbox", { name: "Command" }), "run agent");
  await expect
    .element(page.getByRole("option", { name: /Run agent founders/ }))
    .not.toHaveAttribute("aria-disabled", "true");
  // Below the library search for the typed text.
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => page.getByRole("dialog").query()).toBeNull();
  await expect.poll(() => started).toBe(true);
  expect(payloads).toEqual([{ id: agent.id }]);
  await expect.element(page.getByLabelText("Shared run")).toHaveTextContent("running");
  await expect.poll(() => _screen.router?.state.location.href).toBe("/leads?tab=agents");
  await userEvent.keyboard("{Meta>}k{/Meta}");
  expect(payloads).toEqual([{ id: agent.id }]);
  const command = page.getByRole("textbox", { name: "Command" });
  await userEvent.type(command, "run agent");
  expect(payloads).toEqual([{ id: agent.id }]);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(payloads).toEqual([{ id: agent.id }]);
  await userEvent.keyboard("{Escape}");
  // The palette is gone while the paid search is still out; the run must not die with it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  await expect.poll(() => finished).toBe(true);
  await expect.element(page.getByLabelText("Shared run")).toHaveTextContent("idle");
  await expect
    .element(page.getByRole("status").filter({ hasText: "Agent finished" }))
    .toBeVisible();
});

it.each(["rates", "assist"] as const)(
  "blocks click and Enter while the %s price is missing",
  async (missing) => {
    const runs: Array<number> = [];
    await using _screen = await render(
      <>
        <ShellHotkeys />
        <CommandPalette />
      </>,
      {
        service: {
          "leads.agentsList": () => Effect.succeed([agent]),
          "leads.agentRun": ({ id }) => {
            runs.push(id);
            return Effect.never;
          },
          "costs.quote": ({ actions }) =>
            (missing === "rates" ? actions.length === 0 : actions.length > 0)
              ? Effect.never
              : quoting()({ actions }),
        },
      },
    );
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.type(page.getByRole("textbox", { name: "Command" }), "run agent");
    const option = page.getByRole("option", { name: /Run agent founders/ });
    await expect.element(option).toHaveAttribute("aria-disabled", "true");
    (option.element() as HTMLElement).click();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(runs).toEqual([]);
    await expect.element(page.getByRole("dialog")).toBeVisible();
  },
);

it("New draft opens a new draft", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([]),
      },
    },
  );
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.click(page.getByRole("option", { name: "New draft" }));
  await expect.poll(() => screen.router?.state.location.href).toBe("/compose?new=true");
});

it("contains Tab focus, closes from anywhere on Escape and restores focus", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <button>Opener</button>
      <CommandPalette />
      <button>Outside</button>
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([]),
      },
    },
  );
  await userEvent.click(screen.getByRole("button", { name: "Opener" }));
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(page.getByRole("textbox", { name: "Command" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  expect(page.getByRole("dialog").element().contains(document.activeElement)).toBe(true);
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(page.getByRole("dialog").element().contains(document.activeElement)).toBe(true);
  (page.getByRole("dialog").element() as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => page.getByRole("dialog").query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Opener" })).toHaveFocus();
});

it("reports a failed palette run after navigating to Agents", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
      <Toasts />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "settings.get": () => Effect.succeed(settings),
        "leads.peopleList": () => Effect.succeed(peoplePage()),
        "leads.agentsList": () => Effect.succeed([agent]),
        "leads.agentRun": () =>
          Effect.fail(new LeadsError({ operation: "run", detail: "Budget exceeded", cause: null })),
      },
    },
  );
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await userEvent.type(page.getByRole("textbox", { name: "Command" }), "run agent");
  await expect
    .element(page.getByRole("option", { name: /Run agent founders/ }))
    .not.toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => screen.router?.state.location.href).toBe("/leads?tab=agents");
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Leads failed during run: Budget exceeded");
});
