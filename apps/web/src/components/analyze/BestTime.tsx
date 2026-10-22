import type { HeatmapCell } from "@xtend/contracts";

import { Empty, fmt, Section } from "./ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 7x24 grid of average views per hour of week (UTC). Opacity follows the value. */
export function BestTime({ heatmap }: { readonly heatmap: ReadonlyArray<HeatmapCell> }) {
  if (heatmap.length === 0) return <Empty>Refresh your posts to see when they perform.</Empty>;
  const max = Math.max(...heatmap.map((c) => c.avgViews), 1);
  const cells = new Map(heatmap.map((c) => [c.weekday * 24 + c.hour, c]));
  const top = [...heatmap].sort((a, b) => b.avgViews - a.avgViews).slice(0, 3);
  return (
    <div className="flex flex-col gap-3">
      <Section title="Best hours">
        <ol className="flex gap-6 font-mono text-xs">
          {top.map((c) => (
            <li key={`${c.weekday}-${c.hour}`}>
              {DAYS[c.weekday]} {String(c.hour).padStart(2, "0")}:00 UTC
              <span className="ml-2 text-muted-foreground">
                {fmt(c.avgViews)} avg views, {c.posts} posts
              </span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Average views by hour of week (UTC)">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}
        >
          <span />
          {HOURS.map((h) => (
            <span key={h} className="text-center font-mono text-2xs text-muted-foreground">
              {h}
            </span>
          ))}
          {DAYS.map((day, weekday) => (
            <div key={day} className="contents">
              <span className="font-mono text-2xs text-muted-foreground">{day}</span>
              {HOURS.map((hour) => {
                const cell = cells.get(weekday * 24 + hour);
                return (
                  <div
                    key={hour}
                    title={
                      cell === undefined
                        ? "no posts"
                        : `${fmt(cell.avgViews)} avg views, ${cell.posts} posts`
                    }
                    className="h-5 rounded-sm border border-border bg-foreground"
                    style={{
                      opacity: cell === undefined ? 0.04 : 0.15 + 0.85 * (cell.avgViews / max),
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
