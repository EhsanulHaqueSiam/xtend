import type { SlotInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { draft, rates } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { weekStartIn } from "../../lib/time";
import { Calendar, emptySlotCount } from "./Calendar";
import { Queue } from "./Queue";
import { Slots } from "./Slots";

const DAILY = 127;

it("lays a DST week out in the account zone: past slots gone, drafts by status, a slot filled at its time", async () => {
  // Saturday 7 Mar 2026, 20:00 in New York; the clocks spring forward overnight.
  const zone = "America/New_York";
  const now = new Date("2026-03-08T01:00:00Z");
  const start = weekStartIn(zone, now);
  const slots = [
    { id: 1, weekdayMask: DAILY, minuteOfDay: 3 * 60 + 30 },
    { id: 2, weekdayMask: DAILY, minuteOfDay: 9 * 60 },
  ];
  const drafts = [
    draft("f1", "failed", {
      blocks: [{ text: "Launch thread" }],
      scheduledAt: "2026-03-06T14:00:00.000Z",
    }),
    draft("p1", "posting", {
      blocks: [{ text: "Going out" }],
      scheduledAt: "2026-03-07T14:00:00.000Z",
    }),
    draft("d2", "posted", { postIds: ["1", "2"], postedAt: "2026-03-05T15:00:00.000Z" }),
  ];
  const onFill = vi.fn();
  const onOpen = vi.fn();
  await using screen = await render(
    <Calendar
      zone={zone}
      start={start}
      now={now}
      slots={slots}
      drafts={drafts}
      fillable={[draft("d1", "draft", { blocks: [{ text: "Fill me" }] })]}
      onFill={onFill}
      onOpen={onOpen}
    />,
  );
  await expect.element(screen.getByText("Mon 2")).toBeVisible();
  await expect.element(screen.getByText("09:00 ✕ Launch thread")).toBeVisible();
  await expect.element(screen.getByText("10:00 ✓ 2 posted")).toBeVisible();
  // Only Sunday's slots are still ahead; each earlier one would post on the scheduler's next tick.
  expect(screen.getByLabelText("Empty slot 03:30").elements()).toHaveLength(1);
  expect(screen.getByLabelText("Empty slot 09:00").elements()).toHaveLength(1);
  expect(emptySlotCount(zone, start, now, slots, drafts)).toBe(2);

  await userEvent.selectOptions(screen.getByLabelText("Empty slot 03:30"), "d1");
  // 03:30 on Sunday is already summer time: 07:30 UTC, not the 08:30 of a winter offset.
  expect(onFill).toHaveBeenCalledWith("d1", new Date("2026-03-08T07:30:00.000Z"));
  await userEvent.click(screen.getByText("09:00 Going out"));
  expect(onOpen).toHaveBeenCalledWith(drafts[1]);
});

it("prices each queued draft as Compose does and asks before posting one now", async () => {
  const thread = draft("q1", "queued", {
    blocks: [{ text: "Three tips" }, { text: "photo" }],
    quoteUrl: "https://x.com/levelsio/status/9",
    media: [{ id: "m", blockIndex: 1, path: "/m/a.png", kind: "image", alt: "", position: 0 }],
    scheduledAt: "2030-01-07T09:30:00.000Z",
  });
  const article = draft("a1", "queued", { kind: "article", title: "How I ship", body: "Daily." });
  const failed = draft("f1", "failed", { blocks: [{ text: "broke" }], error: "X refused it" });
  const onRunNow = vi.fn();
  await using screen = await render(
    <Queue
      drafts={[thread, article, failed]}
      onSkip={() => {}}
      onUnschedule={() => {}}
      onRunNow={onRunNow}
      onOpen={() => {}}
    />,
    {
      service: {
        "costs.quote": () => Effect.succeed({ rates, quotes: [] }),
        "compose.quote": () =>
          Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
      },
    },
  );
  const row = (text: string) => screen.getByRole("listitem").filter({ hasText: text });
  // The quote link makes the first post a link post; the post with media goes through the session.
  await expect.element(row("Three tips").getByText("$0.2", { exact: true })).toBeVisible();
  await expect.element(row("How I ship").getByText("$0.04", { exact: true })).toBeVisible();
  await expect.element(row("broke").getByText("X refused it")).toBeVisible();
  // Run now only takes a queued draft.
  await expect.element(row("broke").getByRole("button", { name: "Post now" })).toBeDisabled();

  await userEvent.click(row("Three tips").getByRole("button", { name: "Post now" }));
  await expect
    .element(screen.getByText("Post 2 posts now for $0.2. This charges your treg balance."))
    .toBeVisible();
  expect(onRunNow).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm and post" }));
  expect(onRunNow).toHaveBeenCalledWith("q1");
});

it("edits slot times and days, keeps a cleared time, and saves only slots with a day", async () => {
  let saved: ReadonlyArray<SlotInput> | null = null;
  await using screen = await render(
    <Slots
      slots={[{ id: 1, weekdayMask: 62, minuteOfDay: 9 * 60 }]}
      heatmap={{ cells: [], posts: 14, best: [{ weekday: 2, hour: 18 }] }}
      onSave={(next) => (saved = next)}
    />,
  );
  const save = screen.getByRole("button", { name: "Save" });
  await expect.element(save).toBeDisabled();

  // A best hour becomes a slot on that day.
  await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
  const times = screen.getByLabelText("Slot time");
  expect(times.elements()).toHaveLength(2);
  await userEvent.fill(times.first(), "07:15");
  // Clearing the field mid-edit keeps the time instead of jumping to midnight.
  await userEvent.clear(times.first());
  await expect.element(times.first()).toHaveValue("07:15");

  // A slot with no day cannot be saved.
  const tuesday = screen.getByRole("listitem").nth(1).getByLabelText("Tue");
  await userEvent.click(tuesday);
  await expect.element(save).toBeDisabled();
  await userEvent.click(tuesday);
  await userEvent.click(save);
  expect(saved).toEqual([
    { weekdayMask: 62, minuteOfDay: 7 * 60 + 15 },
    { weekdayMask: 1 << 2, minuteOfDay: 18 * 60 },
  ]);
});
