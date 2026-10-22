import type { AnalyzeData, AnalyzeWindow } from "@xtend/contracts";

import { fmt, LineChart, pct, Section, signed, Stat } from "./ui";

function Window({ w }: { readonly w: AnalyzeWindow }) {
  return (
    <Section title={`Last ${w.days} days`}>
      <div className="grid grid-cols-3 gap-x-4 sm:grid-cols-6">
        <Stat label="Views" value={fmt(w.views)} />
        <Stat label="Likes" value={fmt(w.likes)} />
        <Stat label="Replies" value={fmt(w.replies)} />
        <Stat label="Reposts" value={fmt(w.reposts)} />
        <Stat label="ER" value={pct(w.engagementRate)} sub="engagements over views" />
        <Stat label="Posts / day" value={(w.posts / w.days).toFixed(2)} sub={`${w.posts} posts`} />
      </div>
    </Section>
  );
}

/** Numbers come computed from the service; this only lays them out. */
export function Overview({ data }: { readonly data: AnalyzeData }) {
  const latest = data.snapshots.at(-1);
  const delta = data.followerDelta30d;
  return (
    <div className="flex flex-col gap-3">
      <Section title="Followers">
        <div className="grid grid-cols-3 gap-x-4">
          <Stat
            label="Followers"
            value={fmt(latest?.followers ?? null)}
            sub={
              delta === null
                ? "30-day change needs an older snapshot"
                : `${signed(delta.delta)} since ${delta.sinceDay}`
            }
          />
          <Stat label="Following" value={fmt(latest?.following ?? null)} />
          <Stat label="Posts" value={fmt(latest?.posts ?? null)} />
        </div>
      </Section>
      {data.windows.map((w) => (
        <Window key={w.days} w={w} />
      ))}
      <Section title="Views of posts by day published, 30 days">
        <LineChart points={data.viewsByPostDay.map((d) => ({ label: d.day, value: d.views }))} />
      </Section>
      <Section title="Followers by day">
        <LineChart points={data.snapshots.map((s) => ({ label: s.day, value: s.followers }))} />
      </Section>
    </div>
  );
}
