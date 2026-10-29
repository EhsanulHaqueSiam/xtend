import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  AccountPost,
  AnalyzeData,
  NonPublic,
  PostAnalytics,
  PostKind,
} from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { fmtDay } from "../../lib/time";
import { cn } from "../../lib/utils";
import { analyzeDataAtom, refreshNonPublicAtom } from "../../state/analyze";
import { useRates } from "../../state/costs";
import { HeaderTabs } from "../PageHeader";
import { Button } from "../ui/button";
import { Cost, Empty, Section, Stat, table } from "../ui/layout";
import { useOpenOnX, XLink } from "../ui/x-link";
import { AnalyzePage, NotLoaded } from "./AnalyzePage";
import { engagementRate, errorText, fmt, insetTable, pct, when } from "./ui";

// `hide` drops the less telling columns first as the page narrows (the X panel takes its share).
const COLUMNS = [
  { id: "date", label: "Date", hide: "" },
  { id: "views", label: "Views", hide: "" },
  { id: "likes", label: "Likes", hide: "" },
  { id: "replies", label: "Replies", hide: "hidden @3xl:table-cell" },
  { id: "reposts", label: "Reposts", hide: "hidden @3xl:table-cell" },
  { id: "bookmarks", label: "Saves", hide: "hidden @4xl:table-cell" },
  { id: "er", label: "ER", hide: "" },
] as const;
type Column = (typeof COLUMNS)[number]["id"];
/** X's private metrics, shown once the nightly job has rows. */
const PRIVATE_COLUMNS = [
  { id: "impressions", label: "Impr", hide: "" },
  { id: "profileVisits", label: "Visits", hide: "hidden @5xl:table-cell" },
  { id: "linkClicks", label: "Clicks", hide: "hidden @5xl:table-cell" },
  { id: "follows", label: "Follows", hide: "" },
] as const satisfies ReadonlyArray<{ id: keyof PostAnalytics; label: string; hide: string }>;

const valueOf = (p: AccountPost, c: Column): number =>
  c === "date" ? new Date(p.createdAt).getTime() : c === "er" ? engagementRate(p) : (p[c] ?? 0);

const KINDS = [
  { id: "text", label: "Text" },
  { id: "media", label: "Media" },
  { id: "link", label: "Link" },
  { id: "reply", label: "Reply" },
  { id: "thread", label: "Thread" },
] as const satisfies ReadonlyArray<{ id: PostKind; label: string }>;
type KindFilter = PostKind | "all";

const DAY_MS = 86_400_000;
/** Below this many posts the top and bottom five overlap too much to mean anything. */
const MARK_MIN_POSTS = 10;
// "Oct 24" of the display zone's day: fmtDay's date read back at UTC midnight is that same day.
const dayFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const shortDay = (iso: string) => dayFormat.format(new Date(`${fmtDay(iso)}T00:00:00Z`));

/** Last run, its error, and the paid refresh: one analytics read per own post of the last 30 days. */
function NonPublicStatus({
  nonPublic,
  posts30d,
}: {
  readonly nonPublic: NonPublic;
  readonly posts30d: number;
}) {
  const rates = useRates();
  const refresh = useAtomSet(refreshNonPublicAtom, { mode: "promise" });
  const state = useAtomValue(refreshNonPublicAtom);
  const refreshData = useAtomRefresh(analyzeDataAtom);
  const last = nonPublic.lastRun;
  return (
    <Section
      title="Private metrics"
      className="py-4"
      aside={
        <Button
          size="sm"
          variant="outline"
          disabled={state.waiting}
          // A failure lands in the atom, shown under the status line.
          onClick={() => void refresh().then(refreshData, () => {})}
        >
          <TextMorph duration={250}>{state.waiting ? "Fetching" : "Fetch now"}</TextMorph>
          {rates === null ? <Cost label="…" /> : <Cost usd={rates.readPage * posts30d} />}
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        {last === null
          ? "Impressions, profile visits, link clicks and follows per post need the treg X connection."
          : last.error === null
            ? `Last run ${when(last.at)}, ${last.posts} posts.`
            : `Last run ${when(last.at)} failed: needs the treg X connection (${last.error}).`}
      </p>
      {/* Shown whatever the last run was: older runs may have been the nightly job's own. */}
      <p className="text-xs text-muted-foreground">
        Fetch now also turns on a nightly fetch at 03:00 in your time zone, at the same price.
      </p>
      {AsyncResult.isFailure(state) ? (
        <p role="alert" className="pt-1 text-xs text-error-foreground">
          {errorText(state.cause)}
        </p>
      ) : null}
    </Section>
  );
}

function SortHeader({
  column,
  sort,
  desc,
  onSort,
}: {
  readonly column: (typeof COLUMNS)[number];
  readonly sort: Column;
  readonly desc: boolean;
  readonly onSort: (c: Column) => void;
}) {
  const on = column.id === sort;
  const Arrow = desc ? ChevronDown : ChevronUp;
  return (
    <th
      className={cn(table.th, "text-right", column.hide)}
      aria-sort={on ? (desc ? "descending" : "ascending") : undefined}
      title={column.id === "er" ? "Green: top 5 by engagement rate. Red: bottom 5." : undefined}
    >
      <button
        type="button"
        className={cn(
          "inline-flex cursor-pointer items-center gap-0.5 transition-colors duration-150 hover:text-foreground",
          on && "text-foreground",
        )}
        onClick={() => onSort(column.id)}
      >
        {on ? <Arrow className="size-3" /> : null}
        {column.label}
      </button>
    </th>
  );
}

/** Own posts: averages by type, private metrics, the sortable table, then the posts that gained followers. */
export function Posts({ data }: { readonly data: AnalyzeData }) {
  const { posts, nonPublic } = data;
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<Column>("date");
  const [desc, setDesc] = useState(true);
  const open = useOpenOnX();
  const byEr = [...posts].sort((a, b) => engagementRate(b) - engagementRate(a));
  const marked = posts.length >= MARK_MIN_POSTS;
  const best = new Set(marked ? byEr.slice(0, 5).map((p) => p.postId) : []);
  const worst = new Set(marked ? byEr.slice(-5).map((p) => p.postId) : []);
  const shown = posts
    .filter((p) => kind === "all" || p.kind === kind)
    .sort((a, b) => (valueOf(b, sort) - valueOf(a, sort)) * (desc ? 1 : -1));
  const privateByPost = new Map(nonPublic.byPost.map((r) => [r.postId, r]));
  const hasPrivate = privateByPost.size > 0;
  const gained = nonPublic.byPost
    .filter((r) => r.follows > 0)
    .sort((a, b) => b.follows - a.follows)
    .slice(0, 20);
  const byId = new Map(posts.map((p) => [p.postId, p]));
  // The 30-day cut is what the service applies; the count only prices the button.
  const [nowMs] = useState(() => Date.now());
  const posts30d = posts.filter((p) => nowMs - Date.parse(p.createdAt) < 30 * DAY_MS).length;

  const toggle = (c: Column) => {
    if (c === sort) setDesc((d) => !d);
    else {
      setSort(c);
      setDesc(true);
    }
  };
  const tabs = [
    { id: "all" as const, label: "All" },
    ...KINDS.map((k) => ({ ...k, count: posts.filter((p) => p.kind === k.id).length })),
  ];
  if (data.fetchedAt === null && posts.length === 0)
    return (
      <AnalyzePage data={data}>
        <NotLoaded />
      </AnalyzePage>
    );

  return (
    <AnalyzePage
      data={data}
      tabs={<HeaderTabs label="Type" tabs={tabs} value={kind} onChange={setKind} />}
    >
      <Section title="Average views by type">
        <div className="grid grid-cols-3 gap-x-6 gap-y-4 @2xl:grid-cols-5">
          {KINDS.map((k) => {
            const of = posts.filter((p) => p.kind === k.id);
            const avg =
              of.length === 0 ? 0 : of.reduce((s, p) => s + (p.views ?? 0), 0) / of.length;
            return (
              <Stat
                key={k.id}
                label={`${k.label} · ${of.length} posts`}
                value={of.length === 0 ? "–" : fmt(avg)}
              />
            );
          })}
        </div>
      </Section>
      <NonPublicStatus nonPublic={nonPublic} posts30d={posts30d} />
      {shown.length === 0 ? (
        <Empty>{posts.length === 0 ? "No posts loaded yet." : "No posts of this type."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className={table.root}>
            <thead>
              <tr>
                <th className={table.th}>Post</th>
                <th className={cn(table.th, "hidden @4xl:table-cell")}>Type</th>
                {COLUMNS.map((c) => (
                  <SortHeader key={c.id} column={c} sort={sort} desc={desc} onSort={toggle} />
                ))}
                {hasPrivate
                  ? PRIVATE_COLUMNS.map((c) => (
                      <th key={c.id} className={cn(table.th, "text-right", c.hide)}>
                        {c.label}
                      </th>
                    ))
                  : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr
                  key={p.postId}
                  tabIndex={0}
                  className={cn(
                    table.row,
                    "cursor-pointer outline-hidden focus-visible:bg-white/[0.04]",
                  )}
                  onClick={() => open(p.url)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open(p.url);
                  }}
                >
                  <td className={cn(table.td, "w-full max-w-0")}>
                    <p className="truncate text-foreground/90" title={p.text}>
                      {p.text || "(no text)"}
                    </p>
                  </td>
                  <td
                    className={cn(table.td, "hidden text-xs text-muted-foreground @4xl:table-cell")}
                  >
                    {p.kind}
                  </td>
                  <td
                    className={cn(table.td, table.num, "whitespace-nowrap text-muted-foreground")}
                    title={fmtDay(p.createdAt)}
                  >
                    {shortDay(p.createdAt)}
                  </td>
                  <td className={cn(table.td, table.num)}>{fmt(p.views)}</td>
                  <td className={cn(table.td, table.num)}>{fmt(p.likes)}</td>
                  <td className={cn(table.td, table.num, "hidden @3xl:table-cell")}>
                    {fmt(p.replies)}
                  </td>
                  <td className={cn(table.td, table.num, "hidden @3xl:table-cell")}>
                    {fmt(p.reposts)}
                  </td>
                  <td className={cn(table.td, table.num, "hidden @4xl:table-cell")}>
                    {fmt(p.bookmarks)}
                  </td>
                  <td
                    className={cn(
                      table.td,
                      table.num,
                      best.has(p.postId) && "text-success-foreground",
                      worst.has(p.postId) && "text-error-foreground",
                    )}
                  >
                    {pct(engagementRate(p))}
                  </td>
                  {hasPrivate
                    ? PRIVATE_COLUMNS.map((c) => (
                        <td key={c.id} className={cn(table.td, table.num, c.hide)}>
                          {fmt(privateByPost.get(p.postId)?.[c.id])}
                        </td>
                      ))
                    : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gained.length === 0 ? null : (
        <Section title="Posts that gained followers">
          <table className={insetTable.root}>
            <tbody>
              {gained.map((r) => {
                const post = byId.get(r.postId);
                return (
                  <tr key={r.postId} className={insetTable.row}>
                    <td
                      className={cn(insetTable.td, insetTable.num, "w-16 text-success-foreground")}
                    >
                      +{fmt(r.follows)}
                    </td>
                    <td className={cn(insetTable.td, "max-w-0")}>
                      {post === undefined ? (
                        <span className="font-mono text-xs text-muted-foreground">{r.postId}</span>
                      ) : (
                        <XLink href={post.url} className="block truncate hover:underline">
                          {post.text || "(no text)"}
                        </XLink>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}
    </AnalyzePage>
  );
}
