import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { failText } from "../components/compose/AssistPanel";
import { tabOf } from "../components/compose/DraftsHome";
import { draftTitle, sumUsd, useDraftCost } from "../components/compose/DraftsList";
import { PageHeader } from "../components/PageHeader";
import { Calendar, emptySlotCount } from "../components/plan/Calendar";
import { Queue } from "../components/plan/Queue";
import { Slots } from "../components/plan/Slots";
import { Companion } from "../components/shell/Companion";
import { sectionLabel, useSection } from "../components/shell/sections";
import { Button } from "../components/ui/button";
import { Cost, PageBody } from "../components/ui/layout";
import { XCard } from "../components/x";
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

/** Suggested drafts from Library and Automate, each one click from the next free slot. */
function ReadyToPost({
  drafts,
  onOpen,
  onQueue,
}: {
  readonly drafts: ReadonlyArray<Draft>;
  readonly onOpen: (d: Draft) => void;
  readonly onQueue: (d: Draft) => void;
}) {
  const costOf = useDraftCost();
  return (
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
      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing suggested. Library and Automate leave drafts here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {drafts.map((d) => {
            const cost = costOf(d);
            return (
              <li key={d.id} className="border-b border-border py-2.5 last:border-b-0">
                <button
                  type="button"
                  className="line-clamp-2 w-full cursor-pointer text-left text-[13px] leading-snug hover:underline"
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
                  <Button variant="outline" size="xs" onClick={() => onQueue(d)}>
                    Next slot
                    {cost === null ? <Cost label="…" /> : <Cost usd={cost} />}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
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

  const slotList = AsyncResult.getOrElse(slots, () => []);
  const weekList = AsyncResult.getOrElse(week, () => []);
  const allDrafts = AsyncResult.getOrElse(drafts, () => []);
  const readyList = AsyncResult.getOrElse(ready, () => []);
  const fillable = allDrafts.filter((d) => d.status === "draft" || d.status === "suggested");
  const queued = allDrafts
    .filter((d) => d.status === "queued" || d.status === "failed")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  const empties = emptySlotCount(zone, start, now, slotList, weekList);
  const queueCosts = queued.filter((d) => d.status === "queued").map(costOf);
  const queueUsd = queueCosts.every((c) => c !== null) ? sumUsd(queueCosts) : null;

  /** Every draft action refetches the lists it can move a draft between. */
  const act = async (exit: Promise<Exit.Exit<Draft, unknown>>, done: (d: Draft) => string) => {
    const result = await exit;
    if (Exit.isFailure(result)) {
      setNotice(`Failed: ${failText(result.cause)}`);
      return;
    }
    setNotice(done(result.value));
    refreshWeek();
    refreshDrafts();
    refreshReady();
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
        reply: undefined,
        text: undefined,
        new: undefined,
        tab: undefined,
        ...search,
      },
    });
  const open = (d: Draft) => toCompose({ draft: d.id, tab: tabOf(d.status) });
  const queueNext = (d: Draft) =>
    act(queue(d.id), (q) =>
      q.scheduledAt === null ? "Queued" : `Queued for ${monthDay.format(new Date(q.scheduledAt))}`,
    );

  const detail =
    section === "calendar"
      ? `${empties} open ${empties === 1 ? "slot" : "slots"} ahead · ${zone}`
      : section === "queue"
        ? queued.length === 0
          ? undefined
          : `${queued.length}${queueUsd === null || queueUsd === 0 ? "" : ` · ${usd(queueUsd)}`}`
        : `${slotList.length} ${slotList.length === 1 ? "slot" : "slots"} · ${zone}`;

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
      {AsyncResult.isFailure(slots) ? (
        <p className="shrink-0 border-b border-border px-6 py-2 text-xs text-error-foreground">
          {failText(slots.cause)}
        </p>
      ) : null}
      <PageBody>
        {section === "calendar" ? (
          <Calendar
            zone={zone}
            start={start}
            now={now}
            slots={slotList}
            drafts={weekList}
            fillable={fillable}
            onFill={(id, at) =>
              act(
                schedule({ id, at: at.toISOString() }),
                (d) => `Scheduled "${draftTitle(d)}" for ${monthDay.format(at)}`,
              )
            }
            onOpen={open}
          />
        ) : null}
        {section === "queue" ? (
          <Queue
            drafts={queued}
            emptyAction={
              <Button variant="outline" size="sm" onClick={() => toCompose({ tab: "drafts" })}>
                Open drafts
              </Button>
            }
            onSkip={(id) => act(skip(id), (d) => `Moved "${draftTitle(d)}" to the next slot`)}
            onUnschedule={(id) => act(unschedule(id), (d) => `"${draftTitle(d)}" is a draft again`)}
            onRunNow={(id) =>
              act(runNow(id), (d) =>
                d.status === "posted"
                  ? `Posted ${d.postIds.length} posts`
                  : `Failed: ${d.error ?? "unknown"}`,
              )
            }
            onOpen={open}
          />
        ) : null}
        {section === "slots" && AsyncResult.isSuccess(slots) ? (
          <Slots
            slots={slots.value}
            heatmap={AsyncResult.getOrElse(heatmap, () => null)}
            bestHoursEmpty={
              <Button variant="outline" size="xs" onClick={() => void navigate({ to: "/analyze" })}>
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
        ) : null}
        {section === "slots" ? null : (
          <Companion>
            <ReadyToPost drafts={readyList} onOpen={open} onQueue={queueNext} />
          </Companion>
        )}
      </PageBody>
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanScreen });
