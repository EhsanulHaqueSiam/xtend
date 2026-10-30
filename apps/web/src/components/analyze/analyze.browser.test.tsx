import "../../index.css";

import {
  AnalyzeError,
  type AccountPost,
  type AnalyzeData,
  type CompetitorReport,
  type NonPublic,
  type WatchEntry,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { NOT_A_HANDLE } from "../../lib/utils";
import { AnalyzeScreen } from "../../routes/analyze";
import { Ask } from "./Ask";
import { Competitors } from "./Competitors";
import { Posts } from "./PostsTable";
import { LineChart } from "./ui";

const DAY_MS = 86_400_000;
const noPrivate: NonPublic = { lastRun: null, byPost: [], nightly: null };

/** A post `daysAgo` old whose engagement rate is `likes` per 1000 views. */
const post = (postId: string, likes: number, daysAgo = 1): AccountPost => ({
  postId,
  url: `https://x.com/siamships/status/${postId}`,
  text: `post ${postId}`,
  createdAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  kind: "text",
  views: 1000,
  likes,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
});

/** What `analyze.data` answers for a loaded account; the sections only read it. */
const data = (posts: ReadonlyArray<AccountPost>): AnalyzeData => ({
  handle: "siamships",
  avatarUrl: null,
  fetchedAt: new Date().toISOString(),
  posts,
  snapshots: [],
  heatmap: [],
  timeZone: "UTC",
  windows: [],
  viewsByPostDay: [],
  followerDelta30d: null,
  nonPublic: noPrivate,
});

it("marks the best five green and the worst five red from ten posts on, never one post both", async () => {
  // Seven posts: 7% down to 1% engagement; the oldest is outside the 30-day metrics window.
  const seven = [7, 6, 5, 4, 3, 2, 1].map((likes) =>
    post(String(100 + likes), likes * 10, likes === 1 ? 40 : 1),
  );
  await using screen = await render(<Posts data={data(seven)} />, {
    service: { "costs.quote": quoting() },
  });
  // The engagement-rate cell of the post with that many likes per 1000 views.
  const er = (likes: number) =>
    screen
      .getByRole("row")
      .filter({ hasText: `post ${100 + likes}` })
      .getByText(`${likes}.00%`, { exact: true });
  /** Green, red or neither; read once the table is on screen. */
  const mark = (likes: number) => {
    const cell = er(likes).element();
    return cell.classList.contains("text-success-foreground")
      ? "best"
      : cell.classList.contains("text-error-foreground")
        ? "worst"
        : null;
  };
  await expect.element(er(7)).toBeVisible();
  // Below ten posts the top and bottom five overlap, so none is marked.
  expect([7, 6, 5, 4, 3, 2, 1].map(mark)).toEqual(Array(7).fill(null));
  // One private-metrics read per post of the last 30 days: six at $0.005.
  await expect.element(screen.getByRole("button", { name: /^Fetch now.*\$0\.03$/ })).toBeVisible();

  const twelve = Array.from({ length: 12 }, (_, i) => post(String(112 - i), (12 - i) * 10));
  await screen.rerender(<Posts data={data(twelve)} />);
  await expect.element(er(12)).toHaveClass("text-success-foreground");
  expect([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(mark)).toEqual([
    ...Array(5).fill("best"),
    null,
    null,
    ...Array(5).fill("worst"),
  ]);
});

const watched = (handle: string): WatchEntry => ({
  handle,
  addedAt: "2026-10-20T00:00:00.000Z",
  score: null,
  tier: null,
  change: { d1: null, d7: null, d14: null, d30: null },
});

it("fetches one competitor at a time, and refuses a typo before it reaches the service", async () => {
  const fetched: Array<string> = [];
  let release = () => {};
  const firstFetch = new Promise<void>((resolve) => (release = resolve));
  let reports: ReadonlyArray<CompetitorReport> = [];
  await using screen = await render(<Competitors data={data([post("1", 50)])} />, {
    service: {
      "costs.quote": quoting(() => paid(0.00097)),
      "scores.watchList": () => Effect.succeed([watched("levelsio"), watched("paulg")]),
      "analyze.competitors": () => Effect.sync(() => reports),
      "analyze.competitorFetch": ({ handle }) =>
        Effect.promise(() => firstFetch).pipe(
          Effect.map(() => {
            fetched.push(handle);
            const report = {
              handle,
              fetchedAt: "2026-10-23T00:00:00.000Z",
              profile: null,
              avgViews: 2000,
              topPosts: [],
            };
            reports = [report];
            return report;
          }),
        ),
    },
  });
  const fetches = screen.getByRole("button", { name: "Fetch $0.00097" });
  await expect.poll(() => fetches.elements().length).toBe(2);
  await userEvent.click(fetches.nth(0));
  // Paid reads: the other handle's Fetch waits rather than paying while this one runs.
  await expect.element(fetches.nth(0)).toBeDisabled();
  await expect.element(fetches.nth(1)).toBeDisabled();
  release();
  await expect.element(screen.getByRole("button", { name: "Refetch $0.00097" })).toBeVisible();
  expect(fetched).toEqual(["levelsio"]);
  // Own average 1000 views against their 2000.
  await expect.element(screen.getByText("50%")).toBeVisible();

  await userEvent.fill(screen.getByLabelText("Handle to watch"), "levels io");
  await userEvent.click(screen.getByRole("button", { name: /^Watch/ }));
  await expect.element(screen.getByText(NOT_A_HANDLE)).toBeVisible();
});

it("does not offer to fetch again reports it could not read", async () => {
  await using screen = await render(<Competitors data={data([post("1", 50)])} />, {
    service: {
      "costs.quote": quoting(() => paid(0.00097)),
      "scores.watchList": () => Effect.succeed([watched("levelsio")]),
      "analyze.competitors": () =>
        Effect.fail(new AnalyzeError({ operation: "competitors", detail: "database is locked" })),
    },
  });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Analyze competitors failed: database is locked");
  await expect.element(screen.getByRole("button", { name: /^Fetch/ })).toBeDisabled();
});

it("opens a fetched competitor's top posts from the keyboard", async () => {
  await using screen = await render(<Competitors data={data([post("1", 50)])} />, {
    service: {
      "costs.quote": quoting(),
      "scores.watchList": () => Effect.succeed([watched("levelsio")]),
      "analyze.competitors": () =>
        Effect.succeed([
          {
            handle: "levelsio",
            fetchedAt: "2026-10-23T00:00:00.000Z",
            profile: null,
            avgViews: 2000,
            topPosts: [{ ...post("9", 10), text: "top post nine" }],
          },
        ]),
    },
  });
  const toggle = screen.getByRole("button", { name: "@levelsio" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  (toggle.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("top post nine")).toBeVisible();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await userEvent.keyboard(" ");
  await expect.element(screen.getByText("top post nine")).not.toBeInTheDocument();
});

it("keeps paid Analyze actions off until their price arrives", async () => {
  await using screen = await render(<AnalyzeScreen />, {
    router: "/analyze?tab=posts",
    service: {
      "costs.quote": () => Effect.never,
      "analyze.data": () => Effect.succeed(data([post("1", 10)])),
    },
  });
  await expect.element(screen.getByRole("button", { name: /^Refresh posts/ })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: /^Fetch now/ })).toBeDisabled();
});

it("prices Refresh posts before any refresh, then shows the posts it loaded", async () => {
  const refreshes: Array<number> = [];
  let current = data([post("1", 10)]);
  await using screen = await render(<AnalyzeScreen />, {
    router: "/analyze?tab=posts",
    service: {
      "costs.quote": quoting(() => paid(0.0123)),
      "analyze.data": () => Effect.sync(() => current),
      "analyze.refresh": () =>
        Effect.sync(() => {
          refreshes.push(refreshes.length);
          current = data([post("1", 10), post("2", 20)]);
          return current;
        }),
    },
  });
  const refresh = screen.getByRole("button", { name: /^Refresh posts.*\$0\.0123$/ });
  await expect.element(refresh).toBeEnabled();
  expect(refreshes).toEqual([]);
  await userEvent.click(refresh);
  await expect.element(screen.getByText("post 2")).toBeVisible();
  expect(refreshes).toEqual([0]);
});

it("shows the private metrics Fetch now read", async () => {
  let current = data([post("1", 10)]);
  await using screen = await render(<AnalyzeScreen />, {
    router: "/analyze?tab=posts",
    service: {
      "costs.quote": quoting(),
      "analyze.data": () => Effect.sync(() => current),
      "analyze.refreshNonPublic": () =>
        Effect.sync(() => {
          const row = { postId: "1", day: "2026-10-23", impressions: 4321, profileVisits: 0 };
          current = {
            ...current,
            nonPublic: {
              lastRun: { at: new Date().toISOString(), posts: 1, error: null },
              byPost: [{ ...row, linkClicks: 0, follows: 0, likes: 0, replies: 0, reposts: 0 }],
              nightly: true,
            },
          };
          return current;
        }),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Fetch now/ }));
  await expect.element(screen.getByText("4.3K")).toBeVisible();
});

it("turns the nightly private-metrics fetch off beside its status", async () => {
  const set: Array<boolean> = [];
  let current = { ...data([post("1", 10)]), nonPublic: { ...noPrivate, nightly: true } };
  await using screen = await render(<AnalyzeScreen />, {
    router: "/analyze?tab=posts",
    service: {
      "costs.quote": quoting(),
      "analyze.data": () => Effect.sync(() => current),
      "analyze.nightlySet": ({ on }) =>
        Effect.sync(() => {
          set.push(on);
          current = { ...current, nonPublic: { ...current.nonPublic, nightly: on } };
          return current;
        }),
    },
  });
  const nightly = screen.getByRole("switch", { name: "Nightly fetch" });
  await expect.element(nightly).toBeChecked();
  await userEvent.click(nightly);
  await expect.element(screen.getByText("Nightly fetch off.")).toBeVisible();
  await expect.element(nightly).not.toBeChecked();
  expect(set).toEqual([false]);
});

it("turns the nightly fetch on only once its price is known, and off at any time", async () => {
  const unpriced = (nightly: boolean) =>
    render(<AnalyzeScreen />, {
      router: "/analyze?tab=posts",
      service: {
        "costs.quote": () => Effect.never,
        "analyze.data": () =>
          Effect.succeed({ ...data([post("1", 10)]), nonPublic: { ...noPrivate, nightly } }),
      },
    });
  {
    await using screen = await unpriced(false);
    await expect.element(screen.getByRole("switch", { name: "Nightly fetch" })).toBeDisabled();
  }
  await using screen = await unpriced(true);
  await expect.element(screen.getByRole("switch", { name: "Nightly fetch" })).toBeEnabled();
});

const answering = (asked: Array<string>) => ({
  "costs.quote": quoting(),
  "analyze.ask": ({ question }: { readonly question: string }) =>
    Effect.sync(() => {
      asked.push(question);
      return { answer: "Threads get twice the replies.", followUps: [] };
    }),
});

it("asks only once posts are loaded: an answer over nothing is still a paid call", async () => {
  const asked: Array<string> = [];
  await using screen = await render(<Ask data={data([])} />, { service: answering(asked) });
  await userEvent.fill(screen.getByLabelText("Question"), "Why did it flop?");
  await expect.element(screen.getByRole("button", { name: /^Ask/ })).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  expect(asked).toEqual([]);
  await expect
    .element(screen.getByRole("button", { name: /^Refresh posts/ }).first())
    .toBeEnabled();
});

it("asks the question as typed, once, and shows the answer", async () => {
  const asked: Array<string> = [];
  await using screen = await render(<Ask data={data([post("1", 10)])} />, {
    service: answering(asked),
  });
  await userEvent.fill(screen.getByLabelText("Question"), "Which posts get replies?");
  await userEvent.click(screen.getByRole("button", { name: /^Ask/ }));
  await expect.element(screen.getByText("Threads get twice the replies.")).toBeVisible();
  expect(asked).toEqual(["Which posts get replies?"]);
});

it("inspects Overview history with arrows, Home and End without triggering a paid refresh", async () => {
  const loaded = {
    ...data([post("1", 10)]),
    viewsByPostDay: [
      { day: "2026-10-20", views: 1200, posts: 1 },
      { day: "2026-10-21", views: 182_456, posts: 4 },
      { day: "2026-10-22", views: 209_100, posts: 3 },
    ],
    snapshots: [20, 21, 22].map((day) => ({
      day: `2026-10-${day}`,
      followers: 1000 + day,
      following: 50,
      posts: 20,
    })),
  };
  await using screen = await render(<AnalyzeScreen />, {
    router: "/analyze?tab=overview",
    service: { "costs.quote": quoting(), "analyze.data": () => Effect.succeed(loaded) },
  });
  const chart = screen.getByRole("slider", { name: "2026-10-20 to 2026-10-22 history" }).first();
  await expect.element(chart).toBeVisible();
  (chart.element() as HTMLElement).focus();
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-20 · 1,200");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(screen.getByText("2026-10-21 · 182,456")).toBeVisible();
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-21 · 182,456");
  await userEvent.keyboard("{End}{ArrowRight}");
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-22 · 209,100");
  await userEvent.keyboard("{Home}{ArrowLeft}");
  await expect.element(chart).toHaveAttribute("aria-valuetext", "2026-10-20 · 1,200");
  await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
  await expect.element(chart).toHaveAttribute("aria-valuenow", "1");
  // The followers chart uses the same interaction and keeps an independent selection.
  const followers = screen.getByRole("slider").nth(1);
  (followers.element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await expect.element(followers).toHaveAttribute("aria-valuetext", "2026-10-22 · 1,022");
});

it("the pointer selects the nearest history point, and leaving restores its dates and fitted range", async () => {
  await using screen = await render(
    <LineChart
      points={[
        { label: "Oct 20", value: 52 },
        { label: "Oct 21", value: 54.3 },
        { label: "Oct 22", value: 61 },
      ]}
    />,
  );
  const chart = screen.getByRole("slider");
  const width = chart.element().getBoundingClientRect().width;
  await userEvent.hover(chart, { position: { x: width / 2, y: 40 } });
  await expect.element(screen.getByText("Oct 21 · 54.3")).toBeVisible();
  await userEvent.hover(chart, { position: { x: width - 1, y: 40 } });
  await expect.element(screen.getByText("Oct 22 · 61")).toBeVisible();
  await userEvent.hover(chart, { position: { x: 1, y: 40 } });
  await expect.element(screen.getByText("Oct 20 · 52")).toBeVisible();
  await userEvent.unhover(chart);
  await expect.element(screen.getByText("52 to 61")).toBeVisible();
  expect(screen.getByText(/Oct 20 ·/).elements()).toHaveLength(0);
});

it("empty and single histories stay readable when the data changes", async () => {
  await using screen = await render(<LineChart points={[]} />);
  await expect.element(screen.getByText("Not enough data for a chart yet.")).toBeVisible();
  await screen.rerender(<LineChart points={[{ label: "Oct 20", value: 0 }]} />);
  expect(screen.getByRole("slider").elements()).toHaveLength(0);
  await screen.rerender(
    <LineChart
      points={[
        { label: "Oct 20", value: 1 },
        { label: "Oct 21", value: 2 },
        { label: "Oct 22", value: 3 },
      ]}
    />,
  );
  (screen.getByRole("slider").element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await screen.rerender(
    <LineChart
      points={[
        { label: "Oct 20", value: 1 },
        { label: "Oct 21", value: 2 },
      ]}
    />,
  );
  await expect.element(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "2");
  // A selected index beyond the new end is clamped before reading the point.
  await screen.rerender(<LineChart points={[{ label: "Oct 20", value: 1 }]} />);
  await expect.element(screen.getByText("Not enough data for a chart yet.")).toBeVisible();
  await screen.rerender(
    <LineChart
      points={[
        { label: "Oct 20", value: 1 },
        { label: "Oct 21", value: 2 },
      ]}
    />,
  );
  await expect.element(screen.getByRole("slider")).toBeVisible();
});

it.each([0, 52, -4])("keeps a constant history at %s centered and inspectable", async (value) => {
  await using screen = await render(
    <LineChart
      points={[
        { label: "Oct 20", value },
        { label: "Oct 21", value },
      ]}
    />,
  );
  const chart = screen.getByRole("slider");
  (chart.element() as HTMLElement).focus();
  await userEvent.keyboard("{End}");
  await expect.element(chart).toHaveAttribute("aria-valuetext", `Oct 21 · ${value}`);
  const line = chart.element().querySelector("path[stroke]") as SVGPathElement;
  expect(line.getBBox().height).toBe(0);
  expect(line.getBBox().y).toBeCloseTo(60);
});
