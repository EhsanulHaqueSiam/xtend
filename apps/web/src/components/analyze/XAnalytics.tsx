import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type {
  EngineAccountAnalytics,
  EngineAnalyticsPost,
  EngineAudienceRow,
  EngineMetrics,
} from "@xtend/contracts";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type TableComponents, TableVirtuoso } from "react-virtuoso";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import {
  dropAnalyticsPick,
  engineAtom,
  pickAnalyticsRange,
  sawAnalyticsPage,
  updateEngine,
  viewerHandleAtom,
} from "../../state/engine";
import { xAnalyticsUpsell, xGo, xNavigate, xOverEnded, xPickAnalyticsRange } from "../../state/x";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { sectionLabel } from "../shell/sections";
import { Empty, PageBody, Section, table } from "../ui/layout";
import { Menu, MenuItem } from "../ui/menu";
import { OpenOnX, XLink } from "../ui/x-link";
import { xPillSolid } from "../x";
import { XEmpty } from "../xnative/XRows";
import { insetTable, LineChart } from "./ui";

/** X's range buttons by their label, in days. */
const DAYS = { "7D": 7, "2W": 14, "4W": 28, "28D": 28, "3M": 90, "1Y": 365 } as const;
type Range = keyof typeof DAYS;
type Kind = EngineAccountAnalytics["kind"];

/** Each section's page of X's analytics and the ranges X's page offers there, in X's order. */
const PAGES = {
  "x-overview": {
    kind: "overview",
    path: "/i/account_analytics",
    ranges: ["7D", "2W", "4W", "3M", "1Y"],
  },
  "x-content": {
    kind: "content",
    path: "/i/account_analytics/content",
    ranges: ["7D", "2W", "4W", "3M"],
  },
  "x-video": {
    kind: "video",
    path: "/i/account_analytics/video",
    ranges: ["7D", "2W", "4W", "3M", "1Y"],
  },
  "x-audience": {
    kind: "audience",
    path: "/i/account_analytics/audience",
    ranges: ["7D", "28D", "3M"],
  },
} as const satisfies Record<
  string,
  { readonly kind: Kind; readonly path: string; readonly ranges: ReadonlyArray<Range> }
>;

export type XSection = keyof typeof PAGES;
export const isXSection = (id: string): id is XSection => id in PAGES;

const isKind = <K extends Kind>(
  answer: EngineAccountAnalytics | undefined,
  kind: K,
): answer is Extract<EngineAccountAnalytics, { readonly kind: K }> => answer?.kind === kind;

/**
 * Opens X's analytics page for `section` in the engine while the section is open, and reads X's
 * answer for the range X's page shows. A range pick presses X's own button there; the store keeps
 * it as X's range until X's page answers otherwise. Without X's claims, what X's page shows (its
 * upsell or its analytics) says whether the account has them.
 */
function useXAnalytics(section: XSection) {
  const page = PAGES[section];
  const url = `https://x.com${page.path}`;
  const { access, answers, range } = useAtomValue(engineAtom).accountAnalytics;
  const setEngine = useAtomSet(engineAtom);
  const days = range[page.kind];
  const answer = days === undefined ? undefined : answers.get(`${page.kind}:${days}`);
  const loaded = useRef<Promise<unknown>>(Promise.resolve());
  const live = useRef(new AbortController());
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's analytics page while this section is open, reads whether X shows it or its upsell, and ends a pick still waiting there after.
  useEffect(() => {
    const mine = new AbortController();
    live.current = mine;
    loaded.current = xGo(url);
    void xAnalyticsUpsell(page.path, loaded.current, mine.signal).then((upsell) => {
      if (upsell !== null) setEngine(updateEngine((s) => sawAnalyticsPage(s, upsell)));
    });
    return () => {
      mine.abort();
      xOverEnded();
    };
  }, [url, page.path, setEngine]);
  return {
    url,
    answer,
    answers,
    // X's gate lets in some accounts its claims do not name (verified organisations): an answer wins.
    locked: access === false && answer === undefined,
    tabs: (
      <HeaderTabs<string>
        label="Range"
        tabs={page.ranges.map((r) => ({ id: r, label: r }))}
        value={page.ranges.find((r) => DAYS[r] === days) ?? ""}
        onChange={(id) => {
          const picked = page.ranges.find((r) => r === id);
          if (picked === undefined || DAYS[picked] === days) return;
          const kind = page.kind;
          setEngine(updateEngine((s) => pickAnalyticsRange(s, kind, DAYS[picked])));
          void xPickAnalyticsRange(page.path, picked, loaded.current, live.current.signal).then(
            (pressed) => {
              if (!pressed)
                setEngine(updateEngine((s) => dropAnalyticsPick(s, kind, DAYS[picked], days)));
            },
          );
        }}
      />
    ),
    reload: () => {
      loaded.current = xNavigate(url);
    },
  };
}

/** X's own paywall for its analytics, as X's analytics page shows it to an account without Premium. */
function Paywall() {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[15px] font-semibold">Advanced analytics with Plus</p>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        See your profile analytics, understand your audience and more. Upgrade to continue.
      </p>
      <XLink href="https://x.com/i/premium_sign_up" className={cn(xPillSolid, "mt-2")}>
        Upgrade
      </XLink>
    </div>
  );
}

/**
 * A section's frame: its name, X's ranges, the way to X's own page, then X's paywall, the wait
 * for X's answer, or `children` once X answered.
 */
function XFrame({
  section,
  x,
  ranged = true,
  actions,
  children,
}: {
  readonly section: XSection;
  readonly x: ReturnType<typeof useXAnalytics>;
  /** False where X's page offers no range (an overview under 50 followers). */
  readonly ranged?: boolean;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/analyze", section)}
        tabs={x.locked || !ranged ? undefined : x.tabs}
        actions={
          <>
            {x.locked ? null : actions}
            <OpenOnX href={x.url} />
          </>
        }
      />
      {x.locked ? (
        <Paywall />
      ) : x.answer === undefined ? (
        <XEmpty
          empty={
            isElectron
              ? "Loading X's analytics."
              : "X's analytics come from X's own page, in the desktop app."
          }
          onReopen={x.reload}
        />
      ) : (
        children
      )}
    </div>
  );
}

const DAY_MS = 86_400_000;
const dayLabel = (from: string, i: number) =>
  new Date(Date.parse(from) + i * DAY_MS).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const count = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 1 });
const percent = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

/** The engagements X's overview counts. */
const ENGAGING = ["Bookmark", "Likes", "ProfileVisits", "Retweets", "Replies", "Share"];

/** What X's page derives from its counts: engagements, their rate, and posts. */
const derive = (m: EngineMetrics): EngineMetrics => {
  const engagements = ENGAGING.reduce((n, k) => n + (m[k] ?? 0), 0);
  const impressions = m.Impressions ?? 0;
  return {
    ...m,
    Engagements: engagements,
    EngagementRate: impressions > 0 ? engagements / impressions : 0,
    CreatePost: (m.CreateTweet ?? 0) + (m.CreateQuote ?? 0),
  };
};

const sum = (days: ReadonlyArray<EngineMetrics>) => {
  const out: Record<string, number> = {};
  for (const day of days) for (const [k, v] of Object.entries(day)) out[k] = (out[k] ?? 0) + v;
  return out;
};

/** X's overview tiles, in X's order and words. */
const TILES = [
  ["Impressions", "Impressions"],
  ["EngagementRate", "Engagement rate"],
  ["Engagements", "Engagements"],
  ["ProfileVisits", "Profile visits"],
  ["Replies", "Replies"],
  ["Likes", "Likes"],
  ["Retweets", "Reposts"],
  ["Bookmark", "Bookmarks"],
  ["Share", "Shares"],
] as const;

/** What X's overview chart can show, in X's order. */
const CHART = [
  ["Impressions", "Impressions"],
  ["Likes", "Likes"],
  ["Engagements", "Engagements"],
  ["Bookmark", "Bookmarks"],
  ["Share", "Shares"],
  ["Follows", "New follows"],
  ["Replies", "Replies"],
  ["Retweets", "Reposts"],
  ["ProfileVisits", "Profile visits"],
  ["CreatePost", "Posts"],
] as const;

/** A number as X's tile shows it, with X's change on the range before when there was one. */
function Tile({
  label,
  value,
  before,
}: {
  readonly label: string;
  readonly value: string;
  readonly before?: { readonly now: number; readonly prior: number };
}) {
  const change = before === undefined || before.prior === 0 ? null : before.now / before.prior - 1;
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-x-tile={label}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="font-mono text-[22px] leading-7 tabular-nums">{value}</span>
        {change === null || change === 0 ? null : (
          <span
            className={cn(
              "font-mono text-2xs tabular-nums",
              change > 0 ? "text-success-foreground" : "text-error-foreground",
            )}
          >
            {change > 0 ? "↑" : "↓"}
            {Math.abs(Math.round(change * 100))}%
          </span>
        )}
      </span>
    </div>
  );
}

const pickerClass =
  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--control-radius)] px-2 text-[13px] text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[popup-open]:text-foreground";

/** One of X's dropdowns: its options in X's order, the picked one checked. */
function Picker<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<readonly [T, string]>;
  readonly value: T;
  readonly onChange: (id: T) => void;
}) {
  return (
    <Menu
      align="end"
      label={label}
      trigger={
        <button type="button" aria-label={label} className={pickerClass}>
          {options.find(([id]) => id === value)?.[1]}
          <ChevronDown className="size-3.5" />
        </button>
      }
    >
      {options.map(([id, text]) => (
        <MenuItem key={id} onClick={() => onChange(id)}>
          {text}
          {id === value ? <Check className="ml-auto size-3.5" /> : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** X's Account overview: its chart by day, its tiles with their change, and verified followers. */
function OverviewSection() {
  const x = useXAnalytics("x-overview");
  const [metric, setMetric] = useState<(typeof CHART)[number][0]>("Impressions");
  // X draws bars until "Line" is picked.
  const [chart, setChart] = useState<"line" | "bar">("bar");
  const answer = isKind(x.answer, "overview") ? x.answer : undefined;
  // X's page offers its range and engagement numbers from 50 followers.
  const grown = answer === undefined || answer.followers >= 50;
  const verified =
    answer === undefined || answer.verifiedFollowers === null ? null : (
      <Tile
        label="Verified followers"
        value={`${count(answer.verifiedFollowers)} / ${count(answer.followers)}`}
      />
    );
  return (
    <XFrame section="x-overview" x={x} ranged={grown}>
      {answer === undefined ? null : !grown ? (
        <PageBody>
          <Section>
            <p className="mb-4 text-[13px] text-muted-foreground">
              Detailed engagement metrics become available once you reach 50 followers.
            </p>
            {verified}
          </Section>
        </PageBody>
      ) : (
        <PageBody className="@container">
          <Section
            title={CHART.find(([id]) => id === metric)?.[1] ?? metric}
            aside={
              <>
                <Picker label="Metric" options={CHART} value={metric} onChange={setMetric} />
                <HeaderTabs
                  label="Chart"
                  tabs={[
                    { id: "line", label: "Line" },
                    { id: "bar", label: "Bar" },
                  ]}
                  value={chart}
                  onChange={setChart}
                />
              </>
            }
          >
            <LineChart
              height={180}
              bars={chart === "bar"}
              points={answer.daily.map((day, i) => ({
                label: dayLabel(answer.from, i),
                value: derive(day)[metric] ?? 0,
              }))}
            />
          </Section>
          <Section>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-5">
              {verified}
              <Totals now={derive(sum(answer.daily))} prior={derive(answer.previous)} />
            </div>
          </Section>
        </PageBody>
      )}
    </XFrame>
  );
}

function Totals({ now, prior }: { readonly now: EngineMetrics; readonly prior: EngineMetrics }) {
  return TILES.map(([metric, label]) => (
    <Tile
      key={metric}
      label={label}
      value={metric === "EngagementRate" ? percent(now[metric] ?? 0) : count(now[metric] ?? 0)}
      before={{ now: now[metric] ?? 0, prior: prior[metric] ?? 0 }}
    />
  ));
}

/** X's content types and columns, in X's order. */
const TYPES = [
  ["all", "All"],
  ["posts", "Posts"],
  ["replies", "Replies"],
  ["community", "Community"],
] as const;
const COLUMNS = [
  ["Impressions", "Impressions"],
  ["Likes", "Likes"],
  ["Replies", "Replies"],
  ["Retweets", "Reposts"],
] as const;
type Sort = "date" | (typeof COLUMNS)[number][0];

/** Virtuoso's table, as wide as the page like every other table. */
const ContentTable: NonNullable<TableComponents<EngineAnalyticsPost>["Table"]> = ({
  context: _,
  ...props
}) => <table {...props} className={table.root} />;

const ofType = (p: EngineAnalyticsPost, type: (typeof TYPES)[number][0]) =>
  type === "all" ||
  (type === "replies" && p.reply) ||
  (type === "community" && p.community) ||
  (type === "posts" && !p.reply && !p.community);

/** X's Content: each post in the range with X's numbers; a post opens its own Post Analytics. */
function ContentSection() {
  const x = useXAnalytics("x-content");
  const handle = useAtomValue(viewerHandleAtom) ?? "i";
  const navigate = useNavigate();
  const [type, setType] = useState<(typeof TYPES)[number][0]>("posts");
  const [sort, setSort] = useState<{ readonly by: Sort; readonly desc: boolean }>({
    by: "date",
    desc: true,
  });
  const answer = isKind(x.answer, "content") ? x.answer : undefined;
  const value = (p: EngineAnalyticsPost) =>
    sort.by === "date" ? Date.parse(p.createdAt) : (p.metrics[sort.by] ?? 0);
  const rows = (answer?.posts ?? [])
    .filter((p) => ofType(p, type))
    .toSorted((a, b) => (value(a) - value(b)) * (sort.desc ? -1 : 1));
  const header = (by: Sort, label: string) => {
    const on = sort.by === by;
    const Arrow = sort.desc ? ChevronDown : ChevronUp;
    return (
      <th
        key={by}
        className={cn(table.th, "bg-background", by !== "date" && "text-right")}
        aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
      >
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center gap-0.5 transition-colors duration-150 hover:text-foreground",
            on && "text-foreground",
          )}
          // As on X: the open column flips its order; another starts high to low.
          onClick={() => setSort({ by, desc: on ? !sort.desc : true })}
        >
          {on ? <Arrow className="size-3" /> : null}
          {label}
        </button>
      </th>
    );
  };
  return (
    <XFrame
      section="x-content"
      x={x}
      actions={<Picker label="Type" options={TYPES} value={type} onChange={setType} />}
    >
      {rows.length === 0 ? (
        <Empty>No posts of this type in the range.</Empty>
      ) : (
        <TableVirtuoso
          className="min-h-0 flex-1 [--row-inset:24px]"
          data={rows}
          components={{ Table: ContentTable }}
          computeItemKey={(_, p) => p.postId}
          fixedHeaderContent={() => (
            <tr>
              {header("date", "Date")}
              {COLUMNS.map(([by, label]) => header(by, label))}
            </tr>
          )}
          itemContent={(_, p) => (
            <>
              <td className={cn(table.td, "py-2")}>
                <button
                  type="button"
                  className="flex max-w-xl cursor-pointer flex-col items-start text-left"
                  onClick={() =>
                    void navigate({
                      to: "/post/$id/analytics",
                      params: { id: p.postId },
                      search: { h: handle },
                    })
                  }
                >
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  <span className="line-clamp-2">{p.text}</span>
                </button>
              </td>
              {COLUMNS.map(([metric]) => (
                <td key={metric} className={cn(table.td, table.num)}>
                  {count(p.metrics[metric] ?? 0)}
                </td>
              ))}
            </>
          )}
        />
      )}
    </XFrame>
  );
}

/** A duration as X writes average watch time: m:ss, or h:mm:ss. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
    : `${Math.floor(s / 60)}:${two(s % 60)}`;
};

/** X's Video overview: its four numbers for the range, then the user's videos. */
function VideoSection() {
  const x = useXAnalytics("x-video");
  const handle = useAtomValue(viewerHandleAtom) ?? "i";
  const navigate = useNavigate();
  const answer = isKind(x.answer, "video") ? x.answer : undefined;
  const list = x.answers.get("videos");
  const videos = isKind(list, "videos") ? list.videos : undefined;
  const t = answer?.totals ?? {};
  const starts = t.PlaybackStart ?? 0;
  const watched = t.WatchTime ?? 0;
  const it = insetTable;
  return (
    <XFrame section="x-video" x={x}>
      <PageBody className="@container">
        <Section>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-4">
            <Tile label="Views" value={count(t.VideoView ?? 0)} />
            <Tile label="Watch Time (hours)" value={count(Math.trunc(watched / 360_000) / 10)} />
            <Tile
              label="Completion Rate"
              value={percent(starts > 0 ? (t.PlaybackComplete ?? 0) / starts : 0, 0)}
            />
            <Tile label="Average Watch Time" value={clock(starts > 0 ? watched / starts : 0)} />
          </div>
        </Section>
        <Section title="Your videos">
          {videos === undefined ? (
            <p className="text-[13px] text-muted-foreground">Loading your videos from X.</p>
          ) : videos.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No videos yet.</p>
          ) : (
            <table className={it.root}>
              <thead>
                <tr>
                  <th className={it.th}>Video</th>
                  <th className={it.th}>Published date</th>
                  <th className={cn(it.th, "text-right")}>Views</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => (
                  <tr key={v.mediaKey} className={it.row}>
                    <td className={cn(it.td, "py-2")}>
                      <button
                        type="button"
                        disabled={v.postId === null}
                        className="flex cursor-pointer items-center gap-3 text-left disabled:cursor-default"
                        onClick={() =>
                          v.postId !== null &&
                          void navigate({
                            to: "/post/$id/analytics",
                            params: { id: v.postId },
                            search: { h: handle },
                          })
                        }
                      >
                        {v.previewUrl === null ? null : (
                          <img
                            alt=""
                            src={v.previewUrl}
                            className="h-9 w-16 rounded object-cover"
                          />
                        )}
                        <span className="flex flex-col">
                          <span className="line-clamp-1">{v.name || "Untitled"}</span>
                          <span className="font-mono text-2xs text-muted-foreground">
                            {clock(v.durationMs)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className={cn(it.td, "text-xs text-muted-foreground")}>
                      {new Date(v.createdAt).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className={cn(it.td, it.num)}>{count(v.views)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </PageBody>
    </XFrame>
  );
}

/** What X's audience can break down, in X's order, and the engagement each counts. */
const AUDIENCE_METRICS = [
  ["Likes", "Likes"],
  ["Impressions", "Impressions"],
  ["Bookmark", "Bookmarks"],
  ["Share", "Shares"],
  ["Follows", "New follows"],
  ["Replies", "Replies"],
  ["Retweets", "Reposts"],
  ["ProfileVisits", "Profile visits"],
] as const;
const ENGAGEMENT_OF: Readonly<Record<(typeof AUDIENCE_METRICS)[number][0], string>> = {
  Likes: "Fav",
  Impressions: "Displayed",
  Bookmark: "Bookmark",
  Share: "Share",
  Follows: "Follow",
  Replies: "Reply",
  Retweets: "Retweet",
  ProfileVisits: "ProfilePic",
};
/** X's client app ids by the device X names them. */
const APPS: Readonly<Record<string, string>> = {
  "129032": "iOS",
  "191841": "iOS",
  "557701": "iOS",
  "258901": "Android",
  "3033300": "Web",
  "28551627": "Other",
  "0": "Other",
};
const GENDERS = [
  ["Male", "Male"],
  ["Female", "Female"],
  ["Unknown", "Not specified"],
] as const;
const AGES = [
  ["Age13to17", "13-17"],
  ["Age18to24", "18-24"],
  ["Age25to34", "25-34"],
  ["Age35To44", "35-44"],
  ["Age45To54", "45-54"],
  ["Age55To64", "55-64"],
  ["AgeOver65", "65+"],
] as const;
const DEVICES = ["iOS", "Android", "Web", "Other"] as const;
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const regionName = (code: string) => {
  try {
    return regions.of(code) ?? code;
  } catch {
    // Not a region code Intl knows: X's own word for it.
    return code;
  }
};

/**
 * Each slice's share in percent as X's page rounds it: down to a tenth, and what that leaves of
 * 100 to the largest.
 */
function shares(counts: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return new Map();
  const sorted = [...counts].toSorted((a, b) => b[1] - a[1]);
  const floored = sorted.map(([k, n]) => [k, Math.floor((n / total) * 1000) / 10] as const);
  const left = 100 - floored.reduce((a, [, v]) => a + v, 0);
  return new Map(
    floored.map(([k, v], i) => [k, i === 0 && left > 0 ? Number((v + left).toFixed(1)) : v]),
  );
}

/** Sums the rows of one engagement type by a slice of them; rows without that slice are left out. */
const bySlice = (
  rows: ReadonlyArray<EngineAudienceRow>,
  type: string,
  slice: (r: EngineAudienceRow) => string | null | undefined,
) => {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.type === type ? slice(r) : null;
    if (key !== null && key !== undefined) counts.set(key, (counts.get(key) ?? 0) + r.count);
  }
  return counts;
};

/** A breakdown as X draws it: each slice's share as a bar, or X's line when it has none. */
function Breakdown({
  title,
  slices,
}: {
  readonly title: string;
  readonly slices: ReadonlyArray<readonly [label: string, share: number]>;
}) {
  return (
    <Section title={title} className="m-0">
      {slices.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Not enough data yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slices.map(([label, share]) => (
            <li key={label} className="flex flex-col gap-1">
              <span className="flex justify-between text-[13px]">
                <span>{label}</span>
                <span className="font-mono text-xs tabular-nums">{share.toFixed(1)}%</span>
              </span>
              <span className="h-1.5 rounded-full bg-white/[0.06]">
                <span
                  className="block h-full rounded-full bg-foreground/70"
                  style={{ width: `${share}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** X's Audience: who engaged by gender, age, country and device, for one engagement at a time. */
function AudienceSection() {
  const x = useXAnalytics("x-audience");
  // X opens on Likes.
  const [metric, setMetric] = useState<(typeof AUDIENCE_METRICS)[number][0]>("Likes");
  const answer = isKind(x.answer, "audience") ? x.answer : undefined;
  const rows = answer?.rows ?? [];
  const type = ENGAGEMENT_OF[metric];
  const of = (
    slice: (r: EngineAudienceRow) => string | null | undefined,
    order: ReadonlyArray<readonly [string, string]> | null,
  ) => {
    const s = shares(bySlice(rows, type, slice));
    if (s.size === 0) return [];
    return order === null
      ? [...s].filter(([, v]) => v >= 0.1).map(([k, v]) => [regionName(k), v] as const)
      : order.map(([k, label]) => [label, s.get(k) ?? 0] as const);
  };
  return (
    <XFrame
      section="x-audience"
      x={x}
      actions={
        <Picker label="Metric" options={AUDIENCE_METRICS} value={metric} onChange={setMetric} />
      }
    >
      <PageBody className="@container">
        <div className="grid gap-3 px-6 py-3 @2xl:grid-cols-2">
          <Breakdown
            title="Gender"
            slices={of(
              (r) =>
                r.gender === null || r.gender === "Male" || r.gender === "Female"
                  ? r.gender
                  : "Unknown",
              GENDERS,
            )}
          />
          <Breakdown title="Age" slices={of((r) => (r.age === "Unknown" ? null : r.age), AGES)} />
          <Breakdown
            title="Country"
            slices={of((r) => (r.country === "Other" ? null : r.country), null)}
          />
          <Breakdown
            title="Device"
            slices={of(
              (r) => (r.app === null ? null : APPS[r.app]),
              DEVICES.map((d) => [d, d] as const),
            )}
          />
        </div>
      </PageBody>
    </XFrame>
  );
}

/**
 * X's own account analytics as Analyze sections, read from X's page in the engine through the
 * session: free, and on X a Premium feature, so an account without it sees X's paywall.
 */
export function XAnalyticsSection({ section }: { readonly section: XSection }) {
  switch (section) {
    case "x-overview":
      return <OverviewSection />;
    case "x-content":
      return <ContentSection />;
    case "x-video":
      return <VideoSection />;
    case "x-audience":
      return <AudienceSection />;
  }
}
