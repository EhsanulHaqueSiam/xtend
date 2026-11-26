import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EngineBroadcastRow, EngineBroadcastStats } from "@xtend/contracts";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { engineAtom, sawAnalyticsPage, updateEngine } from "../../state/engine";
import { LIVE_ANALYTICS, xGo, xLiveUpsell, xNavigate } from "../../state/x";
import { PageHeader } from "../PageHeader";
import { sectionLabel } from "../shell/sections";
import { Empty, PageBody, Section, table } from "../ui/layout";
import { OpenOnX, XLink } from "../ui/x-link";
import { XEmpty } from "../xnative/XRows";
import { LineChart } from "./ui";
import { clock, Paywall, Picker } from "./XAnalytics";

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const count = (n: number) => n.toLocaleString("en");
/** X's words for a broadcast's state. */
const STATE: Readonly<Record<string, string>> = {
  Running: "Live",
  NotStarted: "Scheduled",
  Ended: "Ended",
  Canceled: "Canceled",
  PrePublished: "Pre-Published",
  TimedOut: "Timed Out",
};
/** X's filters, in X's order; they narrow the list X sent, asking X for nothing. */
const FILTERS = [
  ["all", "All"],
  ["live", "Live"],
  ["scheduled", "Scheduled"],
  ["ended", "Ended"],
] as const;
type Filter = (typeof FILTERS)[number][0];
const shows = (b: EngineBroadcastRow, filter: Filter) =>
  filter === "all" ||
  (filter === "live" && b.state === "Running") ||
  (filter === "scheduled" &&
    b.scheduledStart !== null &&
    b.state !== "Running" &&
    b.state !== "Ended") ||
  (filter === "ended" && b.state === "Ended");
/** X's default order, newest first, by when it is scheduled or else when it started. */
const dated = (b: EngineBroadcastRow) => Date.parse(b.scheduledStart ?? b.startedAt ?? "") || 0;
/** A broadcast's length, from when it started to when it ended; null for one that has not. */
const length = (b: EngineBroadcastRow) =>
  b.startedAt === null || b.endedAt === null
    ? null
    : Math.max(0, Date.parse(b.endedAt) - Date.parse(b.startedAt));

/**
 * X's Live analytics for the user's own broadcasts, read from X's page (x.com/i/account_analytics/live
 * and a broadcast's own page under it) while the section is open; X's paywall without Premium.
 */
export function XLiveSection() {
  const { broadcastList, broadcastMore, broadcastStats, accountAnalytics } =
    useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const url = `https://x.com${LIVE_ANALYTICS}${open === null ? "" : `/${open}`}`;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's Live analytics page for what the section shows, and reads whether X shows it or its upsell.
  useEffect(() => {
    const mine = new AbortController();
    const loaded = xGo(url);
    if (open === null)
      void xLiveUpsell(loaded, mine.signal).then((upsell) => {
        if (upsell !== null) setEngine(updateEngine((s) => sawAnalyticsPage(s, upsell)));
      });
    return () => mine.abort();
  }, [url, open, setEngine]);
  // X's gate lets in some accounts its claims do not name: X's answer wins.
  const locked = accountAnalytics.access === false && broadcastList === null;
  const stats = open === null ? undefined : broadcastStats.get(open);
  const rows = (broadcastList ?? [])
    .filter((b) => shows(b, filter))
    .toSorted((a, b) => dated(b) - dated(a));
  // Xtend reads X's first page only; the rest are X's own page's.
  const latest = (
    <>
      Showing your latest {broadcastList?.length ?? 0} broadcasts.{" "}
      <XLink href={`https://x.com${LIVE_ANALYTICS}`} className="underline">
        Open on X for all
      </XLink>
    </>
  );
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/analyze", "x-live")}
        leading={
          open === null ? undefined : (
            <button
              type="button"
              aria-label="Back to broadcasts"
              className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/[0.06]"
              onClick={() => setOpen(null)}
            >
              <ArrowLeft className="size-4" />
            </button>
          )
        }
        actions={
          <>
            {locked || open !== null ? null : (
              <Picker label="Filter" options={FILTERS} value={filter} onChange={setFilter} />
            )}
            <OpenOnX href={url} />
          </>
        }
      />
      {locked ? (
        <Paywall />
      ) : open !== null ? (
        stats === undefined ? (
          <XEmpty
            empty="Loading the broadcast's analytics from X."
            onReopen={() => void xNavigate(url)}
          />
        ) : stats === null ? (
          <Empty>X has no analytics for this broadcast. It may have been deleted.</Empty>
        ) : (
          <BroadcastStats stats={stats} />
        )
      ) : broadcastList === null ? (
        <XEmpty
          empty={
            isElectron
              ? "Loading X's Live analytics."
              : "X's analytics come from X's own page, in the desktop app."
          }
          onReopen={() => void xNavigate(url)}
        />
      ) : rows.length === 0 ? (
        <Empty>{broadcastMore ? latest : "No broadcasts available for the selected filter"}</Empty>
      ) : (
        <PageBody>
          <Section>
            <table className={table.root}>
              <thead>
                <tr>
                  <th className={table.th}>Broadcast</th>
                  <th className={cn(table.th, "text-right")}>Views</th>
                  <th className={cn(table.th, "text-right")}>Unique</th>
                  <th className={cn(table.th, "text-right")}>Minutes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <BroadcastRowView
                    key={b.broadcastId}
                    broadcast={b}
                    onOpen={() => setOpen(b.broadcastId)}
                  />
                ))}
              </tbody>
            </table>
            {broadcastMore ? (
              <p className="mt-3 text-[13px] text-muted-foreground">{latest}</p>
            ) : null}
          </Section>
        </PageBody>
      )}
    </div>
  );
}

function BroadcastRowView({
  broadcast: b,
  onOpen,
}: {
  readonly broadcast: EngineBroadcastRow;
  readonly onOpen: () => void;
}) {
  const when = b.startedAt ?? b.scheduledStart;
  const long = length(b);
  return (
    <tr data-x="broadcast-row" className={cn(table.row, "cursor-pointer")} onClick={onOpen}>
      <td className={cn(table.td, "py-2")}>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-3 text-left"
          onClick={onOpen}
        >
          {b.imageUrl === null ? (
            <span className="h-8 w-14 shrink-0 rounded bg-white/[0.06]" />
          ) : (
            <img alt="" src={b.imageUrl} className="h-8 w-14 shrink-0 rounded object-cover" />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-1 font-medium">{b.title || "Untitled"}</span>
            <span className="text-xs text-muted-foreground">
              {[
                when === null ? null : DATE.format(new Date(when)),
                long === null ? null : clock(long),
                STATE[b.state] ?? b.state,
              ]
                .filter((s) => s !== null && s !== "")
                .join(" · ")}
            </span>
          </span>
        </button>
      </td>
      <td className={cn(table.td, table.num)}>{count(b.views)}</td>
      <td className={cn(table.td, table.num)}>{count(b.viewers)}</td>
      <td className={cn(table.td, table.num)}>{count(b.minutesWatched)}</td>
    </tr>
  );
}

/** X's numbers for one broadcast and, once it is over, its Live Viewers by the minute. */
function BroadcastStats({ stats }: { readonly stats: EngineBroadcastStats }) {
  const long = length(stats);
  const tiles = [
    ["Views", count(stats.views)],
    ["Unique viewers", count(stats.viewers)],
    ["Minutes watched", count(stats.minutesWatched)],
    ["Duration", long === null ? "-" : clock(long)],
  ] as const;
  const points = stats.concurrent.map((viewers, minute) => ({
    label: clock(minute * 60_000),
    value: viewers,
  }));
  return (
    <PageBody className="@container">
      <Section
        title={stats.title || "Untitled Broadcast"}
        description={[
          stats.startedAt === null ? null : DATE.format(new Date(stats.startedAt)),
          STATE[stats.state] ?? stats.state,
        ]
          .filter((s) => s !== null && s !== "")
          .join(" · ")}
      >
        <dl className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
          {tiles.map(([label, value]) => (
            <div key={label} data-x-tile={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono text-[22px] leading-7 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {/* X draws a broadcast's viewers once it is over. */}
      {stats.state === "Running" || stats.concurrent.length === 0 ? null : (
        <Section
          title="Live Viewers"
          description={`Peak Viewers: ${count(Math.max(...stats.concurrent))}`}
        >
          <LineChart points={points} unit="viewers" />
        </Section>
      )}
    </PageBody>
  );
}
