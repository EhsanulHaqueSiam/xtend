import type { AnalyzeData } from "@xtend/contracts";

import { engagementRate, fmt, LineChart, pct, Section, signed, Stat } from "./ui";

const DAY_MS = 86_400_000;

const totals = (posts: AnalyzeData["posts"]) => ({
  posts: posts.length,
  views: posts.reduce((s, p) => s + (p.views ?? 0), 0),
  likes: posts.reduce((s, p) => s + p.likes, 0),
  replies: posts.reduce((s, p) => s + p.replies, 0),
  reposts: posts.reduce((s, p) => s + p.reposts, 0),
  er: posts.length === 0 ? 0 : posts.reduce((s, p) => s + engagementRate(p), 0) / posts.length,
});

function Window({
  label,
  posts,
  days,
}: {
  label: string;
  posts: AnalyzeData["posts"];
  days: number;
}) {
  const t = totals(posts);
  return (
    <Section title={label}>
      <div className="grid grid-cols-3 gap-x-4 sm:grid-cols-6">
        <Stat label="Impressions" value={fmt(t.views)} />
        <Stat label="Likes" value={fmt(t.likes)} />
        <Stat label="Replies" value={fmt(t.replies)} />
        <Stat label="Reposts" value={fmt(t.reposts)} />
        <Stat label="Avg ER" value={pct(t.er)} />
        <Stat label="Posts / day" value={(t.posts / days).toFixed(2)} sub={`${t.posts} posts`} />
      </div>
    </Section>
  );
}

export function Overview({ data }: { readonly data: AnalyzeData }) {
  const now = Date.now();
  const within = (days: number) =>
    data.posts.filter((p) => now - new Date(p.createdAt).getTime() < days * DAY_MS);
  const latest = data.snapshots.at(-1);
  const previous = data.snapshots.at(-2);

  const viewsByDay = new Map<string, number>();
  for (const p of within(30)) {
    const day = p.createdAt.slice(0, 10);
    viewsByDay.set(day, (viewsByDay.get(day) ?? 0) + (p.views ?? 0));
  }
  const dailyViews = [...viewsByDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  return (
    <div className="flex flex-col gap-3">
      <Section title="Followers">
        <div className="grid grid-cols-3 gap-x-4">
          <Stat
            label="Followers"
            value={fmt(latest?.followers ?? null)}
            sub={
              latest !== undefined && previous !== undefined
                ? `${signed(latest.followers - previous.followers)} since ${previous.day}`
                : "no earlier snapshot"
            }
          />
          <Stat label="Following" value={fmt(latest?.following ?? null)} />
          <Stat label="Posts" value={fmt(latest?.posts ?? null)} />
        </div>
      </Section>
      <Window label="Last 7 days" posts={within(7)} days={7} />
      <Window label="Last 30 days" posts={within(30)} days={30} />
      <Section title="Daily impressions, 30 days">
        <LineChart points={dailyViews} />
      </Section>
      <Section title="Followers by day">
        <LineChart points={data.snapshots.map((s) => ({ label: s.day, value: s.followers }))} />
      </Section>
    </div>
  );
}
