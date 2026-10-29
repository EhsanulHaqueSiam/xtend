import { useAtomValue } from "@effect/atom-react";
import type { AnalyzeData } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { cn } from "../../lib/utils";
import { seenByAtom } from "../../state/observations";
import { Section, Stat, statRow } from "../ui/layout";
import { AnalyzePage, NotLoaded } from "./AnalyzePage";
import { fmt, insetTable, LineChart, pct, signed } from "./ui";

const CHART_HEIGHT = 140;

/** Numbers come computed from the service; this only lays them out. */
export function Overview({ data }: { readonly data: AnalyzeData }) {
  const latest = data.snapshots.at(-1);
  // Until a Refresh takes a snapshot, the count the session last saw on one of your posts.
  const seen = useAtomValue(seenByAtom(data.handle ?? ""));
  const seenFollowers = AsyncResult.getOrElse(
    AsyncResult.map(seen, ({ posts }) => posts[0]?.author.followers ?? null),
    () => null,
  );
  const delta = data.followerDelta30d;
  const t = insetTable;
  if (data.fetchedAt === null && data.posts.length === 0)
    return (
      <AnalyzePage data={data}>
        <NotLoaded />
      </AnalyzePage>
    );
  return (
    <AnalyzePage data={data}>
      <Section>
        <div className={cn(statRow, "grid-cols-2 gap-y-4 @xl:grid-cols-4")}>
          <Stat
            label={latest === undefined && seenFollowers !== null ? "Followers, seen" : "Followers"}
            value={fmt(latest?.followers ?? seenFollowers)}
          />
          {/* Until a snapshot is 30 days old there is nothing to compare against. */}
          <div title={delta === null ? "Needs a snapshot at least 30 days old" : undefined}>
            <Stat
              label={delta === null ? "30 day change" : `Since ${delta.sinceDay}`}
              value={delta === null ? "–" : signed(delta.delta)}
              tone={
                delta === null || delta.delta === 0 ? undefined : delta.delta > 0 ? "up" : "down"
              }
            />
          </div>
          <Stat label="Following" value={fmt(latest?.following ?? null)} />
          <Stat label="Posts" value={fmt(latest?.posts ?? null)} />
        </div>
      </Section>

      <Section title="Activity">
        <table className={t.root}>
          <thead>
            <tr>
              <th className={t.th}>Window</th>
              <th className={cn(t.th, "text-right")}>Posts</th>
              <th className={cn(t.th, "text-right")}>Per day</th>
              <th className={cn(t.th, "text-right")}>Views</th>
              <th className={cn(t.th, "text-right")}>Likes</th>
              <th className={cn(t.th, "text-right")}>Replies</th>
              <th className={cn(t.th, "text-right")}>Reposts</th>
              <th className={cn(t.th, "text-right")} title="Engagements over views">
                ER
              </th>
            </tr>
          </thead>
          <tbody>
            {data.windows.map((w) => (
              <tr key={w.days} className={t.row}>
                <td className={t.td}>Last {w.days} days</td>
                <td className={cn(t.td, t.num)}>{w.posts}</td>
                <td className={cn(t.td, t.num)}>{(w.posts / w.days).toFixed(2)}</td>
                <td className={cn(t.td, t.num)}>{fmt(w.views)}</td>
                <td className={cn(t.td, t.num)}>{fmt(w.likes)}</td>
                <td className={cn(t.td, t.num)}>{fmt(w.replies)}</td>
                <td className={cn(t.td, t.num)}>{fmt(w.reposts)}</td>
                <td className={cn(t.td, t.num)}>{pct(w.engagementRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid gap-5 px-6 pb-5 @4xl:grid-cols-2">
        <Section title="Views" description="by day published, 30 days" className="m-0">
          <LineChart
            height={CHART_HEIGHT}
            points={data.viewsByPostDay.map((d) => ({ label: d.day, value: d.views }))}
          />
        </Section>
        <Section title="Followers" description="by day" className="m-0">
          <LineChart
            height={CHART_HEIGHT}
            points={data.snapshots.map((s) => ({ label: s.day, value: s.followers }))}
          />
        </Section>
      </div>
    </AnalyzePage>
  );
}
