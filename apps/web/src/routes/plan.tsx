import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { errorText, Section, Tabs } from "../components/analyze/ui";
import { failText } from "../components/compose/AssistPanel";
import { draftTitle } from "../components/compose/DraftsList";
import { PageHeader } from "../components/PageHeader";
import { Calendar, emptySlotCount } from "../components/plan/Calendar";
import { Queue } from "../components/plan/Queue";
import { Slots } from "../components/plan/Slots";
import { Button } from "../components/ui/button";
import { dayStartIn, weekStartIn } from "../lib/time";
import { draftsAtom } from "../state/compose";
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

const TABS = ["Calendar", "Queue", "Slots"] as const;

function PlanScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Calendar");
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
  const range = `${start.toISOString()}|${dayStartIn(zone, start, 7).toISOString()}`;
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();

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
  const open = (d: Draft) =>
    navigate({
      to: "/compose",
      search: {
        draft: d.id,
        inspire: undefined,
        reply: undefined,
        text: undefined,
        new: undefined,
        tab: undefined,
      },
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Plan"
        detail={
          <span className="font-mono">
            {queued.length} queued · {empties} empty {empties === 1 ? "slot" : "slots"} this week
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="xs" onClick={() => setOffsetWeeks((w) => w - 1)}>
              ‹
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setOffsetWeeks(0)}>
              Week of {monthDay.format(start)} · {zone}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setOffsetWeeks((w) => w + 1)}>
              ›
            </Button>
          </>
        }
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {notice !== null ? (
          <p
            className={
              "text-xs " +
              (notice.startsWith("Failed") ? "text-error-foreground" : "text-success-foreground")
            }
          >
            {notice}
          </p>
        ) : null}
        {AsyncResult.isFailure(slots) ? (
          <p className="text-xs text-error-foreground">{errorText(slots.cause)}</p>
        ) : null}
        {tab === "Calendar" ? (
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
        {tab === "Queue" ? (
          <Queue
            drafts={queued}
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
        {tab === "Slots" && AsyncResult.isSuccess(slots) ? (
          <Slots
            slots={slots.value}
            heatmap={AsyncResult.getOrElse(heatmap, () => null)}
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
        <Section title={`Ready to post · ${readyList.length} suggested drafts`}>
          {readyList.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Nothing suggested yet. Library and Automate drop AI drafts here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {readyList.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm">{draftTitle(d)}</span>
                  <span className="font-mono text-2xs text-muted-foreground">
                    {d.blocks.length} posts
                  </span>
                  <Button variant="ghost" size="xs" onClick={() => open(d)}>
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    onClick={() =>
                      act(queue(d.id), (q) =>
                        q.scheduledAt === null
                          ? "Queued"
                          : `Queued for ${monthDay.format(new Date(q.scheduledAt))}`,
                      )
                    }
                  >
                    Next slot
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/plan")({ component: PlanScreen });
