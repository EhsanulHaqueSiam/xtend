import type { FollowerCategory, ScoreReport, TopFollower, XFollower } from "@xtend/contracts";
import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { fmtDay } from "../../lib/time";
import { Empty, fmt, LineChart, pct, Section, signed, Stat } from "../analyze/ui";

const CATEGORIES: ReadonlyArray<{ category: FollowerCategory; label: string }> = [
  { category: "kol", label: "KOLs" },
  { category: "project", label: "Projects" },
  { category: "fund", label: "Funds" },
  { category: "person", label: "People" },
];

/** Mirrors tierFor in the service's ScoreEngine. */
const TIERS = [
  ["Noted", 200],
  ["Credible", 400],
  ["Significant", 600],
  ["Supreme", 900],
] as const;
const nextTier = (score: number) => TIERS.find(([, min]) => score < min);

function Handle({ f }: { f: XFollower }) {
  return (
    <>
      <span className="truncate font-medium">{f.name}</span>
      {f.verified ? <BadgeCheck className="size-3 shrink-0 text-info-foreground" /> : null}
      <a
        href={`https://x.com/${f.handle}`}
        target="_blank"
        rel="noreferrer"
        className="truncate text-muted-foreground hover:underline"
      >
        @{f.handle}
      </a>
    </>
  );
}

function FollowerRow({ f }: { f: TopFollower }) {
  return (
    <li className="flex items-center gap-1 text-xs">
      <Handle f={f} />
      <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
        {fmt(f.followers)} · {f.points.toFixed(1)} pts
      </span>
    </li>
  );
}

/** Bot share, follow ratio and the sampled followers that look fake. */
function BotCheck({ s }: { readonly s: NonNullable<ScoreReport["latest"]> }) {
  return (
    <Section title="Bot check">
      <div className="grid grid-cols-3 gap-x-4">
        <Stat label="Bot share" value={pct(s.bot.botShare)} sub={`of ${s.sampled} sampled`} />
        <Stat
          label="Follow ratio"
          value={s.bot.followRatio === null ? "–" : s.bot.followRatio.toFixed(2)}
          sub="followers / following"
        />
        <Stat label="Suspicious" value={String(s.bot.suspicious.length)} />
      </div>
      {s.bot.suspicious.length === 0 ? (
        <p className="text-xs text-muted-foreground">No suspicious followers in the sample.</p>
      ) : (
        <ul className="flex flex-col gap-1 pt-1">
          {s.bot.suspicious.map((f) => (
            <li key={f.userId} className="flex items-center gap-1 text-xs">
              <Handle f={f} />
              <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                {fmt(f.followers)} / {fmt(f.following)}
                {f.createdAt === null ? "" : ` · since ${f.createdAt.slice(0, 7)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Joined, left and re-weighted followers between the two latest samples. */
function Moved({ moved }: { readonly moved: NonNullable<ScoreReport["moved"]> }) {
  const lists = [
    { label: "Joined", rows: moved.joined.slice(0, 10), delta: (f: TopFollower) => f.points },
    { label: "Left", rows: moved.left.slice(0, 10), delta: (f: TopFollower) => -f.points },
  ] as const;
  const changed = moved.changed.slice(0, 10);
  return (
    <Section title={`Who moved your score since ${fmtDay(moved.sinceAt)}`}>
      {moved.joined.length + moved.left.length + changed.length === 0 ? (
        <p className="text-xs text-muted-foreground">Same scored set as last time.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {lists.map(({ label, rows, delta }) => (
            <div key={label}>
              <p className="pb-1 text-2xs text-muted-foreground">
                {label} ({label === "Joined" ? moved.joined.length : moved.left.length})
              </p>
              <ul className="flex flex-col gap-1">
                {rows.map((f) => (
                  <li key={f.userId} className="flex items-center gap-1 text-xs">
                    <Handle f={f} />
                    <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                      {signed(delta(f))} pts
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="pb-1 text-2xs text-muted-foreground">Changed ({moved.changed.length})</p>
            <ul className="flex flex-col gap-1">
              {changed.map((f) => (
                <li key={f.userId} className="flex items-center gap-1 text-xs">
                  <Handle f={f} />
                  <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                    {f.previousPoints.toFixed(1)} to {f.points.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

/** The Sorsa-style report card: score, tier, who the top followers are by category, what moved, bot check, history. */
export function ReportCard({
  report,
  actions,
  botOnly = false,
}: {
  readonly report: ScoreReport;
  readonly actions?: ReactNode;
  readonly botOnly?: boolean;
}) {
  const s = report.latest;
  const next = s === null ? undefined : nextTier(s.score);
  if (botOnly && s !== null) {
    return (
      <div className="flex flex-col gap-3">
        <Section title={`@${report.handle}`} actions={actions}>
          <p className="text-2xs text-muted-foreground">sampled {fmtDay(s.at)}</p>
        </Section>
        <BotCheck s={s} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Section title={`@${report.handle}`} actions={actions}>
        {s === null ? (
          <Empty>No score yet. Run it to fetch followers and score them.</Empty>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 sm:grid-cols-6">
            <Stat
              label="Score"
              value={fmt(s.score)}
              sub={next === undefined ? "top tier" : `${fmt(next[1] - s.score)} to ${next[0]}`}
            />
            <div className="flex flex-col gap-0.5 py-1">
              <span className="text-2xs text-muted-foreground">Tier</span>
              <span
                className="w-fit rounded-md border border-border px-1.5 font-mono text-sm font-medium"
                data-testid="tier"
              >
                {s.tier}
              </span>
            </div>
            <Stat label="Followers" value={fmt(s.followers)} sub={`${s.sampled} sampled`} />
            <Stat label="Bot share" value={pct(s.botShare)} />
            <Stat
              label="Follow ratio"
              value={s.bot.followRatio === null ? "–" : s.bot.followRatio.toFixed(2)}
            />
            <Stat label="Sampled" value={fmtDay(s.at)} />
          </div>
        )}
      </Section>
      {s === null ? null : (
        <Section title="Top followers by category">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {CATEGORIES.map((b) => {
              const of = s.topFollowers.filter((f) => f.category === b.category);
              const total = s.categories.find((c) => c.category === b.category);
              return (
                <div key={b.category} data-testid={`category-${b.category}`}>
                  <p className="pb-1 text-2xs text-muted-foreground">
                    {b.label} ({total?.count ?? 0} scored, {fmt(total?.points ?? 0)} pts)
                  </p>
                  {of.length === 0 ? (
                    <p className="text-xs text-muted-foreground">none in top 20</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {of.map((f) => (
                        <FollowerRow key={f.userId} f={f} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {report.moved === null ? null : <Moved moved={report.moved} />}
      {s === null ? null : <BotCheck s={s} />}
      <Section title="Score history">
        <LineChart points={report.history.map((h) => ({ label: fmtDay(h.at), value: h.score }))} />
      </Section>
      {report.profileHistory.length === 0 ? null : (
        <Section title="Name and bio history">
          <ol className="flex flex-col gap-1">
            {report.profileHistory
              .toReversed()
              .slice(0, 20)
              .map((c) => (
                <li key={c.day} className="flex gap-2 text-xs">
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">{c.day}</span>
                  <span className="shrink-0 font-medium">{c.name}</span>
                  <span className="truncate text-muted-foreground">{c.bio}</span>
                  <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                    {fmt(c.followers)}
                  </span>
                </li>
              ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
