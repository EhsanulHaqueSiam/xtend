import { ComposeError, type Draft, type SlotInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, onTestFinished, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { draft, quoting, rates, settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { weekStartIn } from "../../lib/time";
import { Route } from "../../routes/plan";
import { CompanionTarget } from "../shell/Companion";
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
      heatmap={null}
      fillable={[draft("d1", "draft", { blocks: [{ text: "Fill me" }] })]}
      busy={false}
      onFill={onFill}
      onOpen={onOpen}
    />,
    { service: { "costs.quote": quoting() } },
  );
  await expect.element(screen.getByText("Mon 2")).toBeVisible();
  // Each draft sits at its time in the zone, with its status beside it.
  const failedAt = screen.getByRole("button", { name: /Launch thread/ });
  await expect.element(failedAt).toMatchTextContent("09:00");
  await expect.element(failedAt).toMatchTextContent("failed");
  const postedAt = screen.getByRole("button", { name: /hello/ });
  await expect.element(postedAt).toMatchTextContent("10:00");
  await expect.element(postedAt).toMatchTextContent("posted");
  // Only Sunday's slots are still ahead; each earlier one would post on the scheduler's next tick.
  expect(screen.getByLabelText("03:30 open slot").elements()).toHaveLength(1);
  expect(screen.getByLabelText("09:00 open slot").elements()).toHaveLength(1);
  expect(emptySlotCount(zone, start, now, slots, drafts)).toBe(2);

  await userEvent.click(screen.getByRole("button", { name: "03:30 open slot" }));
  await userEvent.click(page.getByRole("menuitem", { name: /Fill me/ }));
  // 03:30 on Sunday is already summer time: 07:30 UTC, not the 08:30 of a winter offset.
  expect(onFill).toHaveBeenCalledWith("d1", new Date("2026-03-08T07:30:00.000Z"));
  await userEvent.click(screen.getByRole("button", { name: /Going out/ }));
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
      busy={false}
      emptyAction={null}
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
  await expect.element(row("broke").getByRole("button", { name: /Post now/ })).toBeDisabled();

  await userEvent.click(row("Three tips").getByRole("button", { name: /Post now/ }));
  await expect.element(page.getByText("Post 2 posts now for $0.2.")).toBeVisible();
  await expect.element(page.getByText("Charges your treg balance.")).toBeVisible();
  expect(onRunNow).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole("button", { name: "Confirm and post" }));
  expect(onRunNow).toHaveBeenCalledWith("q1");
});

it("edits slot times and days, keeps a cleared time, and saves only slots with a day", async () => {
  let saved: ReadonlyArray<SlotInput> | null = null;
  await using screen = await render(
    <Slots
      slots={[{ id: 1, weekdayMask: 62, minuteOfDay: 9 * 60 }]}
      heatmap={{ cells: [], posts: 14, best: [{ weekday: 2, hour: 18 }] }}
      bestHoursEmpty={null}
      onSave={async (next) => {
        saved = next;
      }}
    />,
  );
  // Nothing to save until something changes.
  await expect.element(screen.getByText("All changes saved")).toBeVisible();
  const save = screen.getByRole("button", { name: "Save", exact: true });

  // A best hour becomes a slot on that day.
  await userEvent.click(
    screen
      .getByRole("listitem")
      .filter({ hasText: "Tue 18:00" })
      .getByRole("button", { name: "Add slot" }),
  );
  const times = screen.getByLabelText("Slot time");
  expect(times.elements()).toHaveLength(2);
  await userEvent.fill(times.first(), "07:15");
  // Clearing the field mid-edit keeps the time instead of jumping to midnight; leaving it shows it again.
  await userEvent.clear(times.first());
  await userEvent.tab();
  await expect.element(times.first()).toHaveValue("07:15");

  // A slot with no day cannot be saved.
  // Row 0 is the table's head.
  const tuesday = screen.getByRole("row").nth(2).getByLabelText("Tue");
  await userEvent.click(tuesday);
  await expect.element(save).toBeDisabled();
  await userEvent.click(tuesday);
  await userEvent.click(save);
  expect(saved).toEqual([
    { weekdayMask: 62, minuteOfDay: 7 * 60 + 15 },
    { weekdayMask: 1 << 2, minuteOfDay: 18 * 60 },
  ]);
});

it("freezes the slots while they save", async () => {
  let release = () => {};
  await using screen = await render(
    <Slots
      slots={[{ id: 1, weekdayMask: 62, minuteOfDay: 9 * 60 }]}
      heatmap={null}
      bestHoursEmpty={null}
      onSave={() => new Promise<void>((resolve) => (release = resolve))}
    />,
  );
  await userEvent.fill(screen.getByLabelText("Slot time"), "10:00");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect.element(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect.element(screen.getByLabelText("Slot time")).toBeDisabled();
  release();
  await expect.element(screen.getByLabelText("Slot time")).toBeEnabled();
});

const PlanScreen = Route.options.component!;

/** Everything Plan reads on open, with one daily slot late enough to still be ahead today. */
const planService = (rows: () => ReadonlyArray<Draft>, extra: FakeService = {}): FakeService => ({
  "settings.get": () => Effect.succeed(settings),
  "plan.slotsGet": () =>
    Effect.succeed({ slots: [{ id: 1, weekdayMask: DAILY, minuteOfDay: 23 * 60 + 59 }] }),
  "plan.calendar": () => Effect.succeed({ drafts: [] }),
  "plan.ready": () => Effect.succeed({ drafts: [] }),
  "plan.heatmap": () => Effect.succeed({ cells: [], posts: 0, best: [] }),
  "compose.draftsList": () => Effect.sync(() => ({ drafts: rows() })),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
  "costs.quote": quoting(),
  ...extra,
});

it("puts Ready to post above the week without the companion column, and in it when wide", async () => {
  const service = planService(() => [], {
    "plan.ready": () =>
      Effect.succeed({
        drafts: [draft("s1", "suggested", { blocks: [{ text: "Pricing lesson" }] })],
      }),
  });
  {
    await using narrow = await render(<PlanScreen />, { service });
    const strip = narrow.getByRole("region", { name: "Ready to post" });
    await expect.element(strip.getByRole("button", { name: /Next slot/ })).toBeVisible();
    await expect.element(narrow.getByLabelText(/open slot$/).first()).toBeVisible();
    const day = narrow
      .getByLabelText(/open slot$/)
      .first()
      .element();
    // Above the week, so it is in view and a chip drags down onto a day.
    expect(strip.element().compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }
  const column = document.createElement("aside");
  document.body.append(column);
  onTestFinished(() => column.remove());
  await using wide = await render(
    <CompanionTarget value={column}>
      <PlanScreen />
    </CompanionTarget>,
    { service },
  );
  await expect.element(page.getByRole("button", { name: "Pricing lesson" })).toBeVisible();
  expect(column.textContent).toContain("Ready to post");
  expect(wide.getByRole("region", { name: "Ready to post" }).elements()).toHaveLength(0);
});

it("says why the week or the suggestions did not load instead of showing open slots", async () => {
  await using screen = await render(<PlanScreen />, {
    service: planService(() => [], {
      "plan.calendar": () =>
        Effect.fail(new ComposeError({ operation: "calendar", detail: "locked" })),
      "plan.ready": () => Effect.fail(new ComposeError({ operation: "ready", detail: "offline" })),
    }),
  });
  await expect.element(screen.getByText("Compose calendar failed: locked")).toBeVisible();
  await expect.element(screen.getByText("Compose ready failed: offline")).toBeVisible();
  expect(screen.getByLabelText(/open slot$/).elements()).toHaveLength(0);
  expect(screen.getByText(/^Nothing suggested/).elements()).toHaveLength(0);
});

it("unschedules a queued draft back to drafts, holding the other actions until it lands", async () => {
  let rows = [
    draft("q1", "queued", {
      blocks: [{ text: "Weekly build log" }],
      scheduledAt: "2030-01-07T09:30:00.000Z",
    }),
  ];
  const unscheduled: Array<string> = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Skip and Post now are not answered: calling either fails the action and the notice below.
  await using screen = await render(<PlanScreen />, {
    router: "/?tab=queue",
    service: planService(() => rows, {
      "plan.unschedule": ({ id }) => {
        unscheduled.push(id);
        return Effect.promise(() => gate).pipe(
          Effect.map(() => {
            rows = [draft(id, "draft", { blocks: [{ text: "Weekly build log" }] })];
            return rows[0]!;
          }),
        );
      },
    }),
  });
  const postNow = screen.getByRole("button", { name: /Post now/ });
  await expect.element(postNow).toBeEnabled();
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Unschedule" }));
  // One draft action at a time, and the others look it.
  await expect.element(postNow).toBeDisabled();
  release();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent('"Weekly build log" is a draft again');
  await expect.element(screen.getByText("Nothing queued.")).toBeVisible();
  expect(unscheduled).toEqual(["q1"]);
});
