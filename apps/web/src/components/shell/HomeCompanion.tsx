import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { use, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { nextScheduledLabel } from "../../lib/glance";
import { partsIn } from "../../lib/time";
import { inboxItemsAtom } from "../../state/engage";
import { picksAtom } from "../../state/library";
import { pendingAtom } from "../../state/automate";
import { heatmapAtom } from "../../state/plan";
import { settingsAtom } from "../../state/settings";
import { queuedDraftsAtom } from "../../state/shell";
import { CompanionTarget } from "./Companion";

const or = <A, B>(result: AsyncResult.AsyncResult<A, unknown>, fallback: B): A | B =>
  AsyncResult.getOrElse(result, () => fallback);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One card: a title, one line of fact, and the tool it opens with X kept beside it. */
function Card({
  to,
  title,
  count,
  children,
}: {
  readonly to: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="no-drag block border-t border-border py-3 outline-hidden transition-colors duration-150 hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-baseline gap-2 text-[12.5px] font-semibold">
        {title}
        {count !== undefined && count > 0 ? (
          <span className="font-mono text-2xs font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{children}</span>
    </Link>
  );
}

/**
 * The day at a glance: what is queued, what waits on the user, the inbox, today's picks and the
 * best time to post, all from free reads the shell already makes. Each card opens its tool.
 */
export function DayGlance() {
  const queued = or(useAtomValue(queuedDraftsAtom), []);
  const pending = or(useAtomValue(pendingAtom), []).filter((p) => p.status === "pending");
  const inbox = or(useAtomValue(inboxItemsAtom), null);
  const picks = or(useAtomValue(picksAtom), null);
  const heatmap = or(useAtomValue(heatmapAtom), null);
  const settings = or(useAtomValue(settingsAtom), null);
  const zone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const next = nextScheduledLabel(queued, zone, now);
  const open = inbox?.items.filter((m) => !m.handled).length ?? 0;
  const here = partsIn(zone, now);
  const peak = heatmap === null ? 0 : Math.max(...heatmap.cells, 0);
  const nowScore = heatmap?.cells[here.weekday * 24 + here.hour] ?? 0;
  const best = heatmap?.best[0];
  return (
    <>
      <Card to="/plan?tab=queue" title="Up next" count={queued.length}>
        {next === null ? "Nothing queued" : `${next} · ${queued.length} queued`}
      </Card>
      <Card to="/automate?tab=needs-you" title="Needs you" count={pending.length}>
        {pending[0]?.description ?? "No rule is waiting"}
      </Card>
      <Card to="/engage?tab=inbox" title="Inbox" count={open}>
        {open === 0 ? "All handled" : `${open} open`}
      </Card>
      <Card to="/library?tab=picks" title="Picks today" count={picks?.picks.length}>
        {picks === null || picks.picks.length === 0
          ? "None fetched today"
          : picks.keywords.join(", ")}
      </Card>
      <Card
        to="/compose?new=1"
        title={peak > 0 && nowScore >= peak * 0.8 ? "Good time now" : "Best time"}
      >
        {heatmap === null || best === undefined
          ? "Needs 10 observed posts"
          : peak > 0 && nowScore >= peak * 0.8
            ? "Your audience peaks about now"
            : `${DAYS[best.weekday]} ${String(best.hour).padStart(2, "0")}:00`}
      </Card>
    </>
  );
}

/**
 * Home's companion column: the day at a glance in the space x.com's hidden right column leaves.
 * It renders only when the main area is wide enough for the column; below that the sidebar's
 * Today block carries the same facts.
 */
export function HomeCompanion() {
  const target = use(CompanionTarget);
  return target === null ? null : createPortal(<DayGlance />, target);
}
