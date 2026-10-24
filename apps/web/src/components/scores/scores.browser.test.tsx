import { useLocation } from "@tanstack/react-router";
import { ScoresError, type WatchEntry } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { setDisplayZone } from "../../lib/time";
import { NOT_A_HANDLE } from "../../lib/utils";
import { ReportSection } from "./HandleReport";
import { Watchlist } from "./Watchlist";

const entry = (handle: string, addedAt: string): WatchEntry => ({
  handle,
  addedAt,
  score: null,
  tier: null,
  change: { d1: null, d7: null, d14: null, d30: null },
});

/** The Report section as the route mounts it: the handle from `?handle=`, a new one remounting it. */
function ReportAtUrl() {
  const handle = useLocation({
    select: (l) => new URLSearchParams(l.searchStr).get("handle") ?? undefined,
  });
  return <ReportSection key={handle ?? ""} handle={handle} />;
}

it("adds a handle as typed, keeps the input when it is not one or the add fails", async () => {
  const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
  setDisplayZone("Asia/Dhaka");
  onTestFinished(() => setDisplayZone(before));
  const added: Array<string> = [];
  let list: ReadonlyArray<WatchEntry> = [];
  await using screen = await render(<Watchlist onOpen={() => {}} />, {
    service: {
      "costs.quote": quoting(() => paid(0.00522)),
      "scores.watchList": () => Effect.sync(() => list),
      "scores.watchAdd": ({ handle }) =>
        handle === "taken"
          ? Effect.fail(new ScoresError({ operation: "watchAdd", detail: "watchlist is full" }))
          : Effect.sync(() => {
              added.push(handle);
              // Late evening UTC is already the next day in Dhaka.
              list = [entry(handle, "2026-10-22T20:00:00.000Z")];
              return list;
            }),
    },
  });
  const input = screen.getByLabelText("Handle to watch");
  const add = screen.getByRole("button", { name: /^Watch/ });
  await userEvent.fill(input, "two words");
  await userEvent.click(add);
  await expect.element(screen.getByText(NOT_A_HANDLE)).toBeVisible();
  await expect.element(input).toHaveValue("two words");

  await userEvent.fill(input, "taken");
  await userEvent.click(add);
  await expect.element(screen.getByText("Scores watchAdd failed: watchlist is full")).toBeVisible();
  await expect.element(input).toHaveValue("taken");

  await userEvent.fill(input, " @Levels_IO ");
  await userEvent.click(add);
  await expect.element(screen.getByRole("button", { name: "@Levels_IO" })).toBeVisible();
  expect(added).toEqual(["Levels_IO"]);
  await expect.element(input).toHaveValue("");
  await expect.element(screen.getByText("2026-10-23")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /^Score.*\$0\.00522$/ })).toBeVisible();
});

it("opens a typed handle's stored report, and a failed score stays with the handle it was for", async () => {
  const reports: Array<string> = [];
  await using screen = await render(<ReportAtUrl />, {
    service: {
      "costs.quote": quoting(() => paid(0.00522)),
      "scores.report": ({ handle }) =>
        Effect.sync(() => {
          reports.push(handle);
          return { handle, latest: null, history: [], moved: null, profileHistory: [] };
        }),
      "scores.run": ({ handle }) =>
        Effect.fail(new ScoresError({ operation: "run", detail: `@${handle} is private` })),
    },
  });
  const input = screen.getByLabelText("Handle");
  const open = screen.getByRole("button", { name: /^Open/ });
  await userEvent.fill(input, "x.com/levelsio");
  await userEvent.click(open);
  await expect.element(screen.getByText(NOT_A_HANDLE)).toBeVisible();
  expect(reports).toEqual([]);

  await userEvent.fill(input, "@levelsio");
  await userEvent.click(open);
  await expect.element(screen.getByText(/^No score for @levelsio yet/)).toBeVisible();
  expect(reports).toEqual(["levelsio"]);
  await userEvent.click(screen.getByRole("button", { name: /^Score.*\$0\.00522$/ }));
  await expect.element(screen.getByText("Scores run failed: @levelsio is private")).toBeVisible();

  await userEvent.fill(input, "paulg");
  await userEvent.click(open);
  await expect.element(screen.getByText(/^No score for @paulg yet/)).toBeVisible();
  expect(screen.getByText(/is private/).elements()).toHaveLength(0);
});
