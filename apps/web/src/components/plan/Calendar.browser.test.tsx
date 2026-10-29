import type { Draft } from "@xtend/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { Calendar } from "./Calendar";

const draft = (
  id: string,
  status: Draft["status"],
  text: string,
  scheduledAt: string | null,
): Draft => ({
  id,
  kind: "thread",
  status,
  title: "",
  body: "",
  blocks: [{ text }],
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  linkPreviewNote: null,
  threadDelaySeconds: 0,
  source: null,
  quoteUrl: null,
  replyToPostId: null,
  articleId: null,
  media: [],
  scheduledAt,
  postIds: [],
  error: null,
  attempts: 0,
  postedAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
});

// Monday 2030-01-07 in UTC, with "now" at its start so every slot that week is ahead.
const start = new Date("2030-01-07T00:00:00.000Z");

it("puts a draft into an open slot from the slot's menu, and opens a placed one", async () => {
  const onFill = vi.fn();
  const onOpen = vi.fn();
  const placed = draft("q1", "queued", "Weekly build log", "2030-01-08T13:00:00.000Z");
  await using screen = await render(
    <Calendar
      zone="UTC"
      start={start}
      now={start}
      slots={[{ id: 1, weekdayMask: 0b0000110, minuteOfDay: 13 * 60 }]}
      drafts={[placed]}
      heatmap={null}
      fillable={[draft("d1", "draft", "Most dashboards are a list of guilt", null)]}
      onFill={onFill}
      onOpen={onOpen}
    />,
  );
  // Monday's 13:00 is open; Tuesday's is taken by the queued draft.
  await userEvent.click(screen.getByRole("button", { name: "13:00 open slot" }));
  await userEvent.click(page.getByRole("menuitem", { name: /Most dashboards/ }));
  expect(onFill).toHaveBeenCalledWith("d1", new Date("2030-01-07T13:00:00.000Z"));

  expect(screen.getByRole("button", { name: "13:00 open slot" }).elements()).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: /Weekly build log/ }));
  expect(onOpen).toHaveBeenCalledWith(placed);
});

it("drags a queued post to another open slot, and a draft onto an hour of the day ruler", async () => {
  const onFill = vi.fn();
  const placed = draft("q1", "queued", "Weekly build log", "2030-01-08T13:00:00.000Z");
  await using screen = await render(
    <Calendar
      zone="UTC"
      start={start}
      now={start}
      slots={[{ id: 1, weekdayMask: 0b0000110, minuteOfDay: 13 * 60 }]}
      drafts={[placed]}
      heatmap={{ cells: [], posts: 12, best: [{ weekday: 1, hour: 9 }] }}
      fillable={[draft("d1", "draft", "Most dashboards are a list of guilt", null)]}
      onFill={onFill}
      onOpen={vi.fn()}
    />,
  );
  await screen
    .getByRole("button", { name: /Weekly build log/ })
    .dropTo(screen.getByRole("button", { name: "13:00 open slot" }));
  expect(onFill).toHaveBeenCalledWith("q1", new Date("2030-01-07T13:00:00.000Z"));

  // The ruler shows Monday (the week has no today); its 09:00 bar takes a draft from its menu.
  await expect.element(screen.getByText("from 12 observed posts")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "09:00 Mon 7" }));
  await userEvent.click(page.getByRole("menuitem", { name: /Most dashboards/ }));
  expect(onFill).toHaveBeenCalledWith("d1", new Date("2030-01-07T09:00:00.000Z"));
});
