import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EngineSpaceRow, EngineSpaceStats } from "@xtend/contracts";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { engineAtom, sawAnalyticsPage, updateEngine } from "../../state/engine";
import { SPACES_ANALYTICS, xSpacesUpsell } from "../../state/spaces";
import { xGo, xNavigate } from "../../state/x";
import { PageHeader } from "../PageHeader";
import { sectionLabel } from "../shell/sections";
import { Empty, PageBody, Section, table } from "../ui/layout";
import { OpenOnX } from "../ui/x-link";
import { Avatar } from "../xnative/XPostView";
import { XEmpty } from "../xnative/XRows";
import { LineChart } from "./ui";
import { Paywall } from "./XAnalytics";

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
/** "48:20" or "1:02:05". */
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m.padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
/** A Space's length, from when it started to when it ended. */
const length = (from: string | null, to: string | null) =>
  from === null || to === null
    ? "-"
    : clock(Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)));
const count = (n: number | null) => (n === null ? "-" : n.toLocaleString("en"));
/** X's badge for a Space on its list. */
const BADGE: Readonly<Record<string, string>> = {
  Running: "Live",
  Ended: "Ended",
  Scheduled: "Scheduled",
};

/**
 * X's Space analytics for the user's own Spaces, read from X's page (x.com/i/account_analytics/spaces
 * and a Space's own page under it) while the section is open; X's paywall without Premium.
 */
export function XSpacesSection() {
  const { spaceList, spaceStats, accountAnalytics } = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const [open, setOpen] = useState<string | null>(null);
  const url = `https://x.com${SPACES_ANALYTICS}${open === null ? "" : `/${open}`}`;
  const loaded = useRef<Promise<unknown>>(Promise.resolve());
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's Space analytics page for what the section shows, and reads whether X shows it or its upsell.
  useEffect(() => {
    const mine = new AbortController();
    loaded.current = xGo(url);
    if (open === null)
      void xSpacesUpsell(loaded.current, mine.signal).then((upsell) => {
        if (upsell !== null) setEngine(updateEngine((s) => sawAnalyticsPage(s, upsell)));
      });
    return () => mine.abort();
  }, [url, open, setEngine]);
  // X's gate lets in some accounts its claims do not name: X's answer wins.
  const locked = accountAnalytics.access === false && spaceList === null;
  const stats = open === null ? undefined : spaceStats.get(open);
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/analyze", "x-spaces")}
        leading={
          open === null ? undefined : (
            <button
              type="button"
              aria-label="Back to Spaces"
              className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/[0.06]"
              onClick={() => setOpen(null)}
            >
              <ArrowLeft className="size-4" />
            </button>
          )
        }
        actions={<OpenOnX href={url} />}
      />
      {locked ? (
        <Paywall />
      ) : open !== null ? (
        stats === undefined ? (
          <XEmpty
            empty="Loading the Space's analytics from X."
            onReopen={() => void xNavigate(url)}
          />
        ) : (
          <SpaceStats stats={stats} />
        )
      ) : spaceList === null ? (
        <XEmpty
          empty={
            isElectron
              ? "Loading X's Space analytics."
              : "X's analytics come from X's own page, in the desktop app."
          }
          onReopen={() => void xNavigate(url)}
        />
      ) : spaceList.length === 0 ? (
        <Empty>Spaces you host show here, with X's listeners and replays.</Empty>
      ) : (
        <PageBody>
          <Section>
            <table className={table.root}>
              <thead>
                <tr>
                  <th className={table.th}>Space</th>
                  <th className={table.th}>State</th>
                  <th className={cn(table.th, "text-right")}>Length</th>
                  <th className={cn(table.th, "text-right")}>Listeners</th>
                  <th className={cn(table.th, "text-right")}>Replays</th>
                  <th className={cn(table.th, "text-right")}>Speakers</th>
                </tr>
              </thead>
              <tbody>
                {spaceList.map((s) => (
                  <SpaceRowView key={s.spaceId} space={s} onOpen={() => setOpen(s.spaceId)} />
                ))}
              </tbody>
            </table>
          </Section>
        </PageBody>
      )}
    </div>
  );
}

function SpaceRowView({
  space,
  onOpen,
}: {
  readonly space: EngineSpaceRow;
  readonly onOpen: () => void;
}) {
  const when = space.startedAt ?? space.scheduledStart;
  return (
    <tr data-x="space-row" className={cn(table.row, "cursor-pointer")} onClick={onOpen}>
      <td className={table.td}>
        <button type="button" className="cursor-pointer text-left" onClick={onOpen}>
          <span className="block font-medium">{space.title || "Untitled"}</span>
          <span className="text-xs text-muted-foreground">
            {when === null ? "" : DATE.format(new Date(when))}
          </span>
        </button>
      </td>
      <td className={table.td}>
        {space.state === "Ended" && space.recorded
          ? "Recorded"
          : (BADGE[space.state] ?? space.state)}
      </td>
      <td className={cn(table.td, table.num)}>{length(space.startedAt, space.endedAt)}</td>
      <td className={cn(table.td, table.num)}>{count(space.listening)}</td>
      <td className={cn(table.td, table.num)}>{count(space.replays)}</td>
      <td className={cn(table.td, table.num)}>{space.speakers}</td>
    </tr>
  );
}

/** At most this many points on the listeners chart: X counts every second of a long Space. */
const CHART_POINTS = 240;

/** X's Space Stats for one Space, its Concurrent Listeners and its Speakers, in X's words. */
function SpaceStats({ stats }: { readonly stats: EngineSpaceStats }) {
  const navigate = useNavigate();
  const peak = stats.concurrent.length === 0 ? 0 : Math.max(...stats.concurrent);
  const step = Math.max(1, Math.ceil(stats.concurrent.length / CHART_POINTS));
  const points = stats.concurrent.flatMap((viewers, second) =>
    second % step === 0 ? [{ label: clock(second), value: viewers }] : [],
  );
  const tiles: ReadonlyArray<readonly [string, number | null]> = [
    ["Total Participants", stats.participants],
    ["Peak Concurrent Listeners", peak],
    ...(stats.recorded ? ([["Total Replay Watched", stats.replays]] as const) : []),
  ];
  return (
    <PageBody>
      <Section
        title={stats.title || "Untitled"}
        description={[
          stats.startedAt === null ? null : DATE.format(new Date(stats.startedAt)),
          length(stats.startedAt, stats.endedAt),
        ]
          .filter((s) => s !== null && s !== "-")
          .join(" · ")}
        aside={
          stats.recorded ? (
            <button
              type="button"
              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              onClick={() => void navigate({ to: "/spaces/$id", params: { id: stats.spaceId } })}
            >
              Open the recording
            </button>
          ) : null
        }
      >
        <dl className="grid grid-cols-3 gap-4">
          {tiles.map(([label, value]) => (
            <div key={label} data-x-tile={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono text-[22px] leading-7 tabular-nums">{count(value)}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Concurrent Listeners">
        <LineChart points={points} unit="listeners" />
      </Section>
      <Section title={`Speakers (${stats.speakers.length})`}>
        {stats.speakers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No one spoke but the host.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stats.speakers.map((p) => (
              <li key={p.handle} className="flex items-center gap-2 text-[13px]">
                <Avatar url={p.avatarUrl} size={28} />
                <b>{p.name}</b>
                <span className="text-muted-foreground">@{p.handle}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageBody>
  );
}
