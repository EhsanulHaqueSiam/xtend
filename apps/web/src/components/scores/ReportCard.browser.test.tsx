import type { ScoreReport, TopFollower } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { ReportCard } from "./ReportCard";

const follower = (
  userId: string,
  category: TopFollower["category"],
  points: number,
): TopFollower => ({
  userId,
  handle: `h${userId}`,
  name: `Name ${userId}`,
  followers: 1000,
  following: 10,
  verified: false,
  bio: "",
  createdAt: null,
  points,
  category,
});

const report: ScoreReport = {
  handle: "levelsio",
  latest: {
    handle: "levelsio",
    at: "2026-10-22T03:00:00.000Z",
    score: 420,
    tier: "Credible",
    followers: 100_000,
    sampled: 500,
    pages: 5,
    botShare: 0.02,
    topFollowers: [
      follower("1", "kol", 10),
      follower("2", "fund", 8),
      follower("3", "person", 3),
      follower("4", "person", 3),
    ],
    categories: [
      { category: "kol", count: 1, points: 10 },
      { category: "project", count: 0, points: 0 },
      { category: "fund", count: 1, points: 8 },
      { category: "person", count: 98, points: 402 },
    ],
    bot: { botShare: 0.02, followRatio: 50, suspicious: [] },
  },
  history: [],
  moved: {
    sinceAt: "2026-10-21T03:00:00.000Z",
    joined: [follower("1", "kol", 10)],
    left: [],
    changed: [],
  },
  profileHistory: [{ day: "2026-10-22", name: "levels", bio: "ships", followers: 100_000 }],
};

it("buckets the top followers by category and shows who joined", async () => {
  await using screen = await render(<ReportCard report={report} />);
  await expect.element(screen.getByTestId("tier")).toHaveTextContent("Credible");
  const kol = screen.getByTestId("category-kol");
  await expect.element(kol.getByText("1 scored · 10 pts")).toBeVisible();
  await expect.element(kol.getByText("@h1")).toBeVisible();
  await expect
    .element(screen.getByTestId("category-project").getByText("none in top 20"))
    .toBeVisible();
  await expect
    .element(screen.getByTestId("category-person").getByText("98 scored · 402 pts"))
    .toBeVisible();
  await expect.element(screen.getByTestId("moved-joined").getByText("@h1")).toBeVisible();
  await expect.element(screen.getByText("ships")).toBeVisible();
});

it("links the reported account to its profile on X, in the full report and the bot check", async () => {
  await using screen = await render(<ReportCard report={report} />);
  await expect
    .element(screen.getByRole("link", { name: "@levelsio" }))
    .toHaveAttribute("href", "https://x.com/levelsio");
  await screen.rerender(<ReportCard report={report} botOnly />);
  await expect
    .element(screen.getByRole("link", { name: "@levelsio" }))
    .toHaveAttribute("href", "https://x.com/levelsio");
});
