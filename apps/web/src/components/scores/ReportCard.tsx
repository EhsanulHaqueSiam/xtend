import type { ScoreReport, TopFollower, XFollower } from "@xtend/contracts";
import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { Empty, fmt, LineChart, pct, Section, Stat } from "../analyze/ui";

const BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "1000+ followers", min: 1000, max: Infinity },
  { label: "100 to 999", min: 100, max: 1000 },
  { label: "Under 100", min: 0, max: 100 },
];

/** Mirrors tierFor in the service's ScoreEngine. */
const TIERS = [
  ["Noted", 100],
  ["Credible", 500],
  ["Significant", 1000],
  ["Supreme", 2000],
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

/** The Sorsa-style report card: score, tier, who the top followers are, bot check, history. */
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
          <p className="text-2xs text-muted-foreground">sampled {s.at.slice(0, 10)}</p>
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
            <Stat label="Sampled" value={s.at.slice(0, 10)} />
          </div>
        )}
      </Section>
      {s === null ? null : (
        <Section title="Top followers">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {BUCKETS.map((b) => {
              const of = s.topFollowers.filter((f) => f.followers >= b.min && f.followers < b.max);
              return (
                <div key={b.label}>
                  <p className="pb-1 text-2xs text-muted-foreground">
                    {b.label} ({of.length})
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
      {s === null ? null : <BotCheck s={s} />}
      <Section title="Score history">
        <LineChart
          points={report.history.map((h) => ({ label: h.at.slice(0, 10), value: h.score }))}
        />
      </Section>
    </div>
  );
}
