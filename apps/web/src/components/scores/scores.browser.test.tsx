import "../../index.css";

import { useLocation } from "@tanstack/react-router";
import { ScoresError, type ScoreReport, type WatchEntry } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { setDisplayZone } from "../../lib/time";
import { NOT_A_HANDLE } from "../../lib/utils";
import { ScoresScreen } from "../../routes/scores";
import { ReportSection } from "./HandleReport";
import { Trending } from "./Trending";
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

const unscored = (handle: string): ScoreReport => ({
  handle,
  latest: null,
  history: [],
  moved: null,
  profileHistory: [],
});
const scored = (handle: string, pages: number): ScoreReport => ({
  ...unscored(handle),
  latest: {
    handle,
    at: "2026-10-22T03:00:00.000Z",
    score: 420,
    tier: "Credible",
    followers: 100_000,
    sampled: 500,
    pages,
    botShare: 0.02,
    topFollowers: [],
    categories: [],
    bot: { botShare: 0.02, followRatio: 50, suspicious: [] },
  },
});

it("scores the follower pages picked, at their price, and shows the new score", async () => {
  const runs: Array<number | undefined> = [];
  let stored = unscored("levelsio");
  await using screen = await render(<ReportSection handle="levelsio" />, {
    service: {
      "costs.quote": quoting(() => paid(0.00522)),
      "scores.report": () => Effect.sync(() => stored),
      "scores.run": ({ handle, pages }) =>
        Effect.sync(() => {
          runs.push(pages);
          stored = scored(handle, pages ?? 5);
          return stored;
        }),
    },
  });
  const slider = screen.getByRole("slider", { name: "Follower pages" });
  (slider.element() as HTMLElement).focus();
  // Five by default; three steps down is two pages: the profile and two followers pages.
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
  await userEvent.click(screen.getByRole("button", { name: /^Score\s*\$0\.00222$/ }));
  await expect.element(screen.getByTestId("tier")).toHaveTextContent("Credible");
  expect(runs).toEqual([2]);
});

it("keeps paid score and trend loads off until their price arrives", async () => {
  await using screen = await render(
    <>
      <ReportSection handle="levelsio" />
      <Trending />
    </>,
    {
      service: {
        "costs.quote": () => Effect.never,
        "scores.report": () => Effect.succeed(unscored("levelsio")),
      },
    },
  );
  await expect.element(screen.getByRole("button", { name: /^Score/ })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: /^Load/ }).first()).toBeDisabled();
});

it("Report and Bot check keep the handle when the sidebar switches between them", async () => {
  const reports: Array<string> = [];
  await using screen = await render(<ScoresScreen linked="levelsio" />, {
    router: "/scores?tab=report&handle=levelsio",
    service: {
      "costs.quote": quoting(),
      "scores.report": ({ handle }) =>
        Effect.sync(() => {
          reports.push(handle);
          return unscored(handle);
        }),
    },
  });
  await expect.element(screen.getByText(/^No score for @levelsio yet/)).toBeVisible();
  // The sidebar's section link: only ?tab=.
  await screen.router?.navigate({ href: "/scores?tab=bot-check" });
  await screen.rerender(<ScoresScreen linked={undefined} />);
  await expect.element(screen.getByRole("heading", { name: "Bot check" })).toBeVisible();
  await expect.element(screen.getByText(/^No score for @levelsio yet/)).toBeVisible();
  expect(new Set(reports)).toEqual(new Set(["levelsio"]));
});

it("fits a narrow score history to its data and exposes each exact score to keyboard inspection", async () => {
  const report = scored("levelsio", 5);
  const history = [52, 54.3, 61].map((score, index) => ({
    at: `2026-10-${20 + index}T03:00:00.000Z`,
    score,
  }));
  await using screen = await render(<ReportSection handle="levelsio" />, {
    router: "/scores?tab=report&handle=levelsio",
    service: {
      "costs.quote": quoting(),
      "scores.report": () => Effect.succeed({ ...report, history }),
    },
  });
  const chart = screen.getByRole("slider", { name: "2026-10-20 to 2026-10-22 history" });
  await expect.element(chart).toBeVisible();
  const line = chart.element().querySelector("path[stroke]") as SVGPathElement;
  // Nine points of score movement should use most of the 120px chart, not a few pixels at zero.
  expect(line.getBBox().height).toBeGreaterThan(90);
  (chart.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-21 · 54.3");
  await expect.element(screen.getByText("2026-10-21 · 54.3")).toBeVisible();
  await userEvent.keyboard("{End}");
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-22 · 61");
});
