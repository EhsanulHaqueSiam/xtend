import type { SignalAgent } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { CommandPalette } from "./CommandPalette";
import { ShellHotkeys } from "./ShellHotkeys";

it("opens on ⌘K, filters commands and closes on Escape", async () => {
  await using screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
  );
  expect(page.getByRole("dialog").query()).toBeNull();

  await userEvent.keyboard("{Meta>}k{/Meta}");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect.element(palette).toBeVisible();
  await expect.element(palette.getByRole("option", { name: "Compose" })).toBeVisible();

  await userEvent.type(page.getByRole("textbox", { name: "Command" }), "pla");
  await expect.element(palette.getByRole("option", { name: "Plan", exact: true })).toBeVisible();
  expect(palette.getByRole("option", { name: "Compose" }).query()).toBeNull();

  await userEvent.keyboard("{Escape}");
  expect(page.getByRole("dialog").query()).toBeNull();
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
        "leads.agentsList": () => Effect.succeed([agent]),
      },
    },
  );
  // Typing a command letter in the palette's box filters; it never navigates.
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(page.getByText("paid run up to $0.01175")).toBeVisible();
  const box = page.getByRole("textbox", { name: "Command" });
  await userEvent.type(box, "a");
  expect(screen.router?.state.location.pathname).toBe("/");
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("option", { selected: true })).toHaveTextContent("Plan");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => screen.router?.state.location.pathname).toBe("/plan");
  expect(page.getByRole("dialog").query()).toBeNull();

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

it("an agent run started from the palette finishes after the palette closes", async () => {
  let release = () => {};
  const searched = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  let finished = false;
  await using _screen = await render(
    <>
      <ShellHotkeys />
      <CommandPalette />
    </>,
    {
      service: {
        "costs.quote": quoting(),
        "leads.agentsList": () => Effect.succeed([agent]),
        "leads.agentRun": ({ id }) =>
          Effect.promise(() => {
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
  // Below the library search for the typed text.
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(page.getByRole("dialog").query()).toBeNull();
  await expect.poll(() => started).toBe(true);
  // The palette is gone while the paid search is still out; the run must not die with it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  await expect.poll(() => finished).toBe(true);
});
