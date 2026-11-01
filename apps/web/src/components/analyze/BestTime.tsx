import type { AnalyzeData } from "@xtend/contracts";

import { cn } from "../../lib/utils";
import { Empty, Section, Stat } from "../ui/layout";
import { AnalyzePage, RefreshPosts } from "./AnalyzePage";
import { fmt } from "./ui";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => String(h).padStart(2, "0");
/** Opacity of a cell with no posts, and the floor and span of one with posts. */
const EMPTY = 0.05;
const FLOOR = 0.12;

/** 7x24 grid of average views per hour of week in the account's zone. Opacity follows the value. */
export function BestTime({ data }: { readonly data: AnalyzeData }) {
  const { heatmap, timeZone } = data;
  if (heatmap.length === 0)
    return (
      <AnalyzePage data={data} detail={timeZone}>
        <Empty action={<RefreshPosts />}>Refresh your posts to see when they perform.</Empty>
      </AnalyzePage>
    );
  const max = Math.max(...heatmap.map((c) => c.avgViews), 1);
  const cells = new Map(heatmap.map((c) => [c.weekday * 24 + c.hour, c]));
  const top = [...heatmap].sort((a, b) => b.avgViews - a.avgViews).slice(0, 3);
  const topKeys = new Set(top.map((c) => c.weekday * 24 + c.hour));
  return (
    <AnalyzePage data={data} detail={timeZone}>
      <Section title="Best hours">
        <div className="grid grid-cols-3 gap-x-6">
          {top.map((c) => (
            <Stat
              key={`${c.weekday}-${c.hour}`}
              label={`${fmt(c.avgViews)} avg views · ${c.posts} posts`}
              value={`${DAYS[c.weekday]} ${hh(c.hour)}:00`}
            />
          ))}
        </div>
      </Section>
      <Section
        title="Average views by hour of week"
        aside={
          <div className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
            fewer
            {[EMPTY, 0.3, 0.55, 0.8, 1].map((o) => (
              <span
                key={o}
                className="size-2.5 rounded-[2px] bg-foreground"
                style={{ opacity: o }}
              />
            ))}
            more
          </div>
        }
      >
        <div
          role="img"
          aria-label={`Average views by hour of week, ${timeZone}`}
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}
        >
          <span />
          {HOURS.map((h) => (
            <span
              key={h}
              className="pb-1 text-center font-mono text-2xs text-muted-foreground tabular-nums"
            >
              {h % 3 === 0 ? hh(h) : ""}
            </span>
          ))}
          {DAYS.map((day, weekday) => (
            <div key={day} className="contents">
              <span className="self-center font-mono text-2xs text-muted-foreground">{day}</span>
              {HOURS.map((hour) => {
                const key = weekday * 24 + hour;
                const cell = cells.get(key);
                return (
                  <Tooltip key={hour}>
                    <TooltipTrigger
                      render={
                        <div
                          className={cn(
                            "h-6 rounded-[3px] bg-foreground",
                            topKeys.has(key) && "outline-1 outline-foreground",
                          )}
                          style={{
                            opacity:
                              cell === undefined
                                ? EMPTY
                                : FLOOR + (1 - FLOOR) * (cell.avgViews / max),
                          }}
                        />
                      }
                    />
                    <TooltipPopup>{`${day} ${hh(hour)}:00, ${
                      cell === undefined
                        ? "no posts"
                        : `${fmt(cell.avgViews)} avg views, ${cell.posts} posts`
                    }`}</TooltipPopup>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </Section>
    </AnalyzePage>
  );
}
