import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { use, useState } from "react";

import { failText } from "../components/compose/AssistPanel";
import { tabOf } from "../components/compose/DraftsHome";
import { draftTitle, sumUsd, useDraftCost } from "../components/compose/DraftsList";
import { PageHeader } from "../components/PageHeader";
import { Calendar, emptySlotCount } from "../components/plan/Calendar";
import { Queue } from "../components/plan/Queue";
import { Slots } from "../components/plan/Slots";
import { Companion, CompanionTarget } from "../components/shell/Companion";
import { sectionLabel, useSection } from "../components/shell/sections";
import { Button } from "../components/ui/button";
import { Cost, Empty, PageBody } from "../components/ui/layout";
import { XCard } from "../components/x";
import { DRAFT_TYPE } from "../lib/drag";
import { cn } from "../lib/utils";
import { dayStartIn, weekStartIn } from "../lib/time";
import { draftsAtom } from "../state/compose";
import { usd } from "../state/costs";
import {
  calendarAtom,
  heatmapAtom,
  queueAtom,
  readyAtom,
  runNowAtom,
  scheduleAtom,
  setSlotsAtom,
  skipAtom,
  slotsAtom,
  unscheduleAtom,
} from "../state/plan";
import { settingsAtom } from "../state/settings";

/**
 * Suggested drafts from Library and Automate, one click from the next free slot or a drag onto
 * the calendar. A companion card when the main area is wide; a strip above the week otherwise,
 * so it stays in view while a draft is dragged onto a day.
 */
function ReadyToPost({
  ready,
  busy,
  strip,
  onOpen,
  onQueue,
}: {
  readonly ready: AsyncResult.AsyncResult<ReadonlyArray<Draft>, unknown>;
  /** Another draft action is in flight. */
  readonly busy: boolean;
  readonly strip: boolean;
  readonly onOpen: (d: Draft) => void;
  readonly onQueue: (d: Draft) => void;
}) {
  const costOf = useDraftCost();
  const drafts = AsyncResult.getOrElse(ready, (): ReadonlyArray<Draft> => []);
  const body = (
    <>
      {AsyncResult.isFailure(ready) ? (
        <p className="text-xs text-error-foreground">{failText(ready.cause)}</p>
      ) : AsyncResult.isInitial(ready) ? (
        <p className="text-xs text-muted-foreground">Loading</p>
      ) : drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing suggested. Library and Automate leave drafts here.
        </p>
      ) : (
        <ul className={strip ? "flex gap-4" : "flex flex-col"}>
          {drafts.map((d) => {
            const cost = costOf(d);
            return (
              <li
                key={d.id}
                draggable
                className={cn(
                  "cursor-grab active:cursor-grabbing",
                  strip
                    ? "w-60 shrink-0 border-r border-border pr-4 last:border-r-0"
                    : "border-b border-border py-2.5 last:border-b-0",
                )}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAFT_TYPE, d.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "w-full cursor-pointer text-left text-[13px] leading-snug hover:underline",
                    strip ? "truncate" : "line-clamp-2",
                  )}
                  onClick={() => onOpen(d)}
                >
                  {draftTitle(d)}
                </button>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="flex-1 font-mono text-2xs text-muted-foreground tabular-nums">
                    {d.kind === "article"
                      ? "article"
                      : `${d.blocks.length} ${d.blocks.length === 1 ? "post" : "posts"}`}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy || cost === null}
                    onClick={() => onQueue(d)}
                  >
                    Next slot
                    {cost === null ? <Cost label="…" /> : <Cost usd={cost} />}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  return strip ? (
    <section
      aria-label="Ready to post"
      className="flex shrink-0 items-start gap-4 overflow-x-auto border-b border-border px-6 py-2.5"
    >
      <h2 className="shrink-0 py-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
        Ready {drafts.length}
      </h2>
      {body}
    </section>
  ) : (
    <XCard
      title="Ready to post"
      aside={
        drafts.length > 0 ? (
          <span className="font-mono text-2xs font-normal text-muted-foreground">
            {drafts.length}
          </span>
        ) : undefined
      }
    >
      {body}
    </XCard>
  );
}

function PlanScreen() {
  const section = useSection("/plan");
  // Read once per mount; the nudge and "today" only need to be right to the minute.
  const [now] = useState(() => new Date());
  // Weeks are laid out in the account's zone; until Settings answers, the browser's.
  const settings = useAtomValue(settingsAtom);
  const zone = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.timeZone),
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const monthDay = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: zone,
  });
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const start = dayStartIn(zone, weekStartIn(zone, now), offsetWeeks * 7);
  const end = dayStartIn(zone, start, 6);
  const range = `${start.toISOString()}|${dayStartIn(zone, start, 7).toISOString()}`;
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const costOf = useDraftCost();
  // Without the wide companion column, Ready to post would sit under a full-height week.
  const companion = use(CompanionTarget);
  const readyStrip = section === "calendar" && companion === null;

  const slots = useAtomValue(slotsAtom);
  const week = useAtomValue(calendarAtom(range));
  const drafts = useAtomValue(draftsAtom);
  const ready = useAtomValue(readyAtom);
  const heatmap = useAtomValue(heatmapAtom);
  const refreshSlots = useAtomRefresh(slotsAtom);
  const refreshWeek = useAtomRefresh(calendarAtom(range));
  const refreshDrafts = useAtomRefresh(draftsAtom);
  const refreshReady = useAtomRefresh(readyAtom);

  const setSlots = useAtomSet(setSlotsAtom, { mode: "promiseExit" });
  const queue = useAtomSet(queueAtom, { mode: "promiseExit" });
  const schedule = useAtomSet(scheduleAtom, { mode: "promiseExit" });
  const skip = useAtomSet(skipAtom, { mode: "promiseExit" });
  const unschedule = useAtomSet(unscheduleAtom, { mode: "promiseExit" });
  const runNow = useAtomSet(runNowAtom, { mode: "promiseExit" });

  const allDrafts = AsyncResult.getOrElse(drafts, () => []);
  // The calendar shows slots, the week's posts and the drafts to place; with one of them missing
  // a taken slot would look open, so it waits for all three.
  const calendar = AsyncResult.all([slots, week, drafts]);
  const queued = allDrafts
    .filter((d) => d.status === "queued" || d.status === "failed")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const empties = AsyncResult.isSuccess(calendar)
    ? emptySlotCount(zone, start, now, calendar.value[0], calendar.value[1])
    : null;
  const queueCosts = queued.filter((d) => d.status === "queued").map(costOf);
  const queueUsd = queueCosts.every((c) => c !== null) ? sumUsd(queueCosts) : null;

  // One draft action at a time: a second Skip or Next slot click would move the draft again.
  const [acting, setActing] = useState(false);
  /** Every draft action refetches the lists it can move a draft between. */
  const act = async (run: () => Promise<Exit.Exit<Draft, unknown>>, done: (d: Draft) => string) => {
    if (acting) return;
    setActing(true);
    try {
      const result = await run();
      if (Exit.isFailure(result)) {
        setNotice(`Failed: ${failText(result.cause)}`);
        return;
      }
      setNotice(done(result.value));
      refreshWeek();
      refreshDrafts();
      refreshReady();
    } finally {
      setActing(false);
    }
  };
  const toCompose = (search: {
    readonly draft?: string;
    readonly new?: true;
    readonly tab?: ReturnType<typeof tabOf>;
  }) =>
    navigate({
      to: "/compose",
      search: {
        draft: undefined,
        inspire: undefined,
        quote: undefined,
        reply: undefined,
        text: undefined,
        new: undefined,
        tab: undefined,
        ...search,
      },
    });
  const open = (d: Draft) => toCompose({ draft: d.id, tab: tabOf(d.status) });
  const queueNext = (d: Draft) =>
    act(
      () => queue(d.id),
      (q) =>
        q.scheduledAt === null
          ? "Queued"
          : `Queued for ${monthDay.format(new Date(q.scheduledAt))}`,
    );

  const detail =
    section === "calendar"
      ? empties === null
        ? zone
        : `${empties} open ${empties === 1 ? "slot" : "slots"} ahead · ${zone}`
      : section === "queue"
        ? queued.length === 0
          ? undefined
          : `${queued.length}${queueUsd === null || queueUsd === 0 ? "" : ` · ${usd(queueUsd)}`}`
        : AsyncResult.isSuccess(slots)
          ? `${slots.value.length} ${slots.value.length === 1 ? "slot" : "slots"} · ${zone}`
          : zone;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/plan", section)}
        detail={detail}
        actions={
          section === "calendar" ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous week"
                onClick={() => setOffsetWeeks((w) => w - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="font-mono text-xs tabular-nums"
                title="Back to this week"
                disabled={offsetWeeks === 0}
                onClick={() => setOffsetWeeks(0)}
              >
                {monthDay.format(start)} – {monthDay.format(end)}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next week"
                onClick={() => setOffsetWeeks((w) => w + 1)}
              >
                <ChevronRight />
              </Button>
            </>
          ) : undefined
        }
      />
      {notice !== null ? (
        <p
          role="status"
          className={cn(
            "shrink-0 border-b border-border px-6 py-2 text-xs",
            notice.startsWith("Failed") ? "text-error-foreground" : "text-muted-foreground",
          )}
        >
          {notice}
        </p>
      ) : null}
      {readyStrip ? (
        <ReadyToPost ready={ready} busy={acting} strip onOpen={open} onQueue={queueNext} />
      ) : null}
      <PageBody>
        {section === "calendar"
          ? AsyncResult.match(calendar, {
              onInitial: () => <Empty>Loading the week</Empty>,
              onFailure: (f) => <Empty>{failText(f.cause)}</Empty>,
              onSuccess: ({ value: [slotList, weekList, all] }) => (
                <Calendar
                  zone={zone}
                  start={start}
                  now={now}
                  slots={slotList}
                  drafts={weekList}
                  heatmap={AsyncResult.getOrElse(heatmap, () => null)}
                  fillable={all.filter((d) => d.status === "draft" || d.status === "suggested")}
                  busy={acting}
                  onFill={(id, at) => {
                    const draft = all.find((d) => d.id === id);
                    // The calendar's clock stops when Plan opens; a slot gone since would post on the next tick.
                    if (at.getTime() <= Date.now()) setNotice("Failed: that slot has passed");
                    // Placing a paid post waits for its price, a drop included.
                    else if (draft !== undefined && costOf(draft) === null)
                      setNotice("Failed: its price is not known yet");
                    else
                      void act(
                        () => schedule({ id, at: at.toISOString() }),
                        (d) => `Scheduled "${draftTitle(d)}" for ${monthDay.format(at)}`,
                      );
                  }}
                  onOpen={open}
                />
              ),
            })
          : null}
        {section === "queue"
          ? AsyncResult.match(drafts, {
              onInitial: () => <Empty>Loading the queue</Empty>,
              onFailure: (f) => <Empty>{failText(f.cause)}</Empty>,
              onSuccess: () => (
                <Queue
                  drafts={queued}
                  busy={acting}
                  emptyAction={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toCompose({ tab: "drafts" })}
                    >
                      Open drafts
                    </Button>
                  }
                  onSkip={(id) =>
                    act(
                      () => skip(id),
                      (d) => `Moved "${draftTitle(d)}" to the next slot`,
                    )
                  }
                  onUnschedule={(id) =>
                    act(
                      () => unschedule(id),
                      (d) => `"${draftTitle(d)}" is a draft again`,
                    )
                  }
                  onRunNow={(id) =>
                    act(
                      () => runNow(id),
                      (d) =>
                        d.status === "posted"
                          ? `Posted ${d.postIds.length} posts`
                          : `Failed: ${d.error ?? "unknown"}`,
                    )
                  }
                  onOpen={open}
                />
              ),
            })
          : null}
        {section === "slots"
          ? AsyncResult.match(slots, {
              onInitial: () => <Empty>Loading slots</Empty>,
              onFailure: (f) => <Empty>{failText(f.cause)}</Empty>,
              onSuccess: ({ value }) => (
                <Slots
                  // A save comes back in the service's order; the rows start over from it.
                  key={JSON.stringify(value)}
                  slots={value}
                  heatmap={AsyncResult.getOrElse(heatmap, () => null)}
                  bestHoursEmpty={
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void navigate({ to: "/analyze" })}
                    >
                      Analyze
                    </Button>
                  }
                  onSave={async (next) => {
                    const exit = await setSlots(next);
                    setNotice(
                      Exit.isFailure(exit)
                        ? `Failed: ${failText(exit.cause)}`
                        : `Saved ${exit.value.slots.length} slots`,
                    );
                    refreshSlots();
                  }}
                />
              ),
            })
          : null}
        {section === "slots" || readyStrip ? null : (
          <Companion>
            <ReadyToPost
              ready={ready}
              busy={acting}
              strip={false}
              onOpen={open}
              onQueue={queueNext}
            />
          </Companion>
        )}
      </PageBody>
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanScreen });
