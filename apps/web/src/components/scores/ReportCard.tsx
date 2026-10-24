import type { FollowerCategory, ScoreReport, TopFollower, XFollower } from "@xtend/contracts";
import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { LineChart } from "../analyze/ui";
import { Empty, Section, Stat, table } from "../ui/layout";
import { fmt } from "../library/shared";
import { XLink, profileUrl } from "../library/XLink";

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
const TOP = TIERS[TIERS.length - 1]![1];
const nextTier = (score: number) => TIERS.find(([, min]) => score < min);

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signedPts = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

type Sample = NonNullable<ScoreReport["latest"]>;

/** Name, badge and @handle; the handle opens the profile on X. */
function Who({ f }: { readonly f: XFollower }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate">{f.name}</span>
      {f.verified ? <BadgeCheck className="size-3 shrink-0 text-foreground/60" /> : null}
      <XLink
        href={profileUrl(f.handle)}
        className="truncate text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        @{f.handle}
      </XLink>
    </span>
  );
}

/** One person in a short list, a mono figure on the right. */
function PersonRow({ f, figure }: { readonly f: XFollower; readonly figure: string }) {
  return (
    <li className="flex h-7 items-center gap-2 border-b border-border text-[13px] last:border-b-0">
      <Who f={f} />
      <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
        {figure}
      </span>
    </li>
  );
}

/** A labelled column of people: the label, a mono count, the rows. */
function PeopleColumn({
  label,
  count,
  testId,
  children,
}: {
  readonly label: string;
  readonly count: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="min-w-0">
      <p className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">{count}</span>
      </p>
      {children}
    </div>
  );
}

/** The section's own hairline closes a table, so its last row draws none. */
const lastRowOpen = "[&_tbody_tr:last-child_td]:border-b-0";

const quiet = (text: string) => <p className="py-2 text-xs text-muted-foreground">{text}</p>;

/** Where the score sits on the tier ladder. Static: no fill animation. */
function TierScale({ score }: { readonly score: number }) {
  return (
    <div className="relative mt-5 h-6 max-w-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-white/13" />
      <div
        className="absolute top-0 left-0 h-px bg-foreground"
        style={{ width: `${Math.min(100, (score / TOP) * 100)}%` }}
      />
      {TIERS.map(([name, min]) => (
        <span
          key={name}
          className={cn(
            "absolute top-0 -translate-x-full border-r pt-1.5 pr-1.5 font-mono text-3xs whitespace-nowrap tabular-nums",
            score >= min
              ? "border-foreground text-foreground/80"
              : "border-white/13 text-muted-foreground",
          )}
          style={{ left: `${(min / TOP) * 100}%` }}
        >
          {name} {min}
        </span>
      ))}
    </div>
  );
}

/** Bot share, follow ratio and the sampled followers that look fake. */
function BotCheck({ s }: { readonly s: Sample }) {
  return (
    <Section title="Bot check">
      <div className="grid grid-cols-3 gap-x-6 pb-4 @min-[40rem]:max-w-xl">
        <Stat label={`Bot share of ${s.sampled}`} value={pct(s.bot.botShare)} />
        <Stat
          label="Follow ratio"
          value={s.bot.followRatio === null ? "–" : s.bot.followRatio.toFixed(2)}
        />
        <Stat label="Suspicious" value={String(s.bot.suspicious.length)} />
      </div>
      {s.bot.suspicious.length === 0 ? (
        quiet("No suspicious followers in the sample.")
      ) : (
        <table className={cn(table.root, lastRowOpen, "-mx-6 w-[calc(100%+3rem)]")}>
          <thead>
            <tr>
              <th className={table.th}>Follower</th>
              <th className={cn(table.th, "w-28 text-right")}>Followers</th>
              <th className={cn(table.th, "w-28 text-right")}>Following</th>
              <th className={cn(table.th, "w-28 text-right")}>Joined X</th>
            </tr>
          </thead>
          <tbody>
            {s.bot.suspicious.map((f) => (
              <tr key={f.userId} className={table.row}>
                <td className={cn(table.td, "max-w-0")}>
                  <Who f={f} />
                </td>
                <td className={cn(table.td, table.num)}>{fmt(f.followers)}</td>
                <td className={cn(table.td, table.num)}>{fmt(f.following)}</td>
                <td className={cn(table.td, table.num, "text-muted-foreground")}>
                  {f.createdAt === null ? "–" : f.createdAt.slice(0, 7)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** Joined, left and re-weighted followers between the two latest samples. */
function Moved({ moved }: { readonly moved: NonNullable<ScoreReport["moved"]> }) {
  const changed = moved.changed.slice(0, 10);
  const total = moved.joined.length + moved.left.length + moved.changed.length;
  const list = (rows: ReadonlyArray<TopFollower>, delta: (f: TopFollower) => number) =>
    rows.length === 0 ? (
      quiet("None")
    ) : (
      <ul>
        {rows.slice(0, 10).map((f) => (
          <PersonRow key={f.userId} f={f} figure={`${signedPts(delta(f))} pts`} />
        ))}
      </ul>
    );
  return (
    <Section title={`Who moved the score since ${moved.sinceAt.slice(0, 10)}`}>
      {total === 0 ? (
        quiet("Same scored set as last time.")
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 @min-[44rem]:grid-cols-3">
          <PeopleColumn label="Joined" count={String(moved.joined.length)} testId="moved-joined">
            {list(moved.joined, (f) => f.points)}
          </PeopleColumn>
          <PeopleColumn label="Left" count={String(moved.left.length)} testId="moved-left">
            {list(moved.left, (f) => -f.points)}
          </PeopleColumn>
          <PeopleColumn label="Changed" count={String(moved.changed.length)}>
            {changed.length === 0 ? (
              quiet("None")
            ) : (
              <ul>
                {changed.map((f) => (
                  <PersonRow
                    key={f.userId}
                    f={f}
                    figure={`${f.previousPoints.toFixed(1)} to ${f.points.toFixed(1)}`}
                  />
                ))}
              </ul>
            )}
          </PeopleColumn>
        </div>
      )}
    </Section>
  );
}

/**
 * A handle's report: score and tier, who the top followers are by category,
 * what moved, the bot check and the history. `actions` is the score run,
 * drawn beside the score.
 */
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
  if (s === null)
    return (
      <Empty action={actions}>
        No score for @{report.handle} yet. Scoring reads its profile and a sample of followers.
      </Empty>
    );
  const next = nextTier(s.score);
  const sampledLine = `@${report.handle} · sampled ${s.at.slice(0, 10)} · ${s.pages} pages`;

  if (botOnly)
    return (
      <>
        <section className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-4">
          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
            {sampledLine}
          </span>
          <div className="ml-auto">{actions}</div>
        </section>
        <BotCheck s={s} />
      </>
    );

  return (
    <>
      <section className="border-b border-border px-6 py-6">
        <div className="flex flex-wrap items-start gap-x-12 gap-y-5">
          <div>
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-[34px] leading-none tracking-tight tabular-nums">
                {fmt(s.score)}
              </span>
              <span className="text-[15px] font-semibold" data-testid="tier">
                {s.tier}
              </span>
            </p>
            <p className="mt-2 font-mono text-2xs text-muted-foreground tabular-nums">
              {next === undefined ? "top tier" : `${fmt(next[1] - s.score)} to ${next[0]}`}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 pt-0.5 @min-[40rem]:grid-cols-4">
            <Stat label="Followers" value={fmt(s.followers)} />
            <Stat label="Sampled" value={fmt(s.sampled)} />
            <Stat label="Bot share" value={pct(s.botShare)} />
            <Stat
              label="Follow ratio"
              value={s.bot.followRatio === null ? "–" : s.bot.followRatio.toFixed(2)}
            />
          </div>
          {actions !== undefined ? <div className="ml-auto self-center">{actions}</div> : null}
        </div>
        <TierScale score={s.score} />
        <p className="font-mono text-2xs text-muted-foreground tabular-nums">{sampledLine}</p>
      </section>
      <Section title="Top followers by category">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
          {CATEGORIES.map((b) => {
            const of = s.topFollowers.filter((f) => f.category === b.category);
            const total = s.categories.find((c) => c.category === b.category);
            return (
              <PeopleColumn
                key={b.category}
                testId={`category-${b.category}`}
                label={b.label}
                count={`${total?.count ?? 0} scored · ${fmt(total?.points ?? 0)} pts`}
              >
                {of.length === 0 ? (
                  quiet("none in top 20")
                ) : (
                  <ul>
                    {of.map((f) => (
                      <PersonRow
                        key={f.userId}
                        f={f}
                        figure={`${fmt(f.followers)} · ${f.points.toFixed(1)}`}
                      />
                    ))}
                  </ul>
                )}
              </PeopleColumn>
            );
          })}
        </div>
      </Section>
      {report.moved === null ? null : <Moved moved={report.moved} />}
      <BotCheck s={s} />
      <Section title="Score history">
        <LineChart
          points={report.history.map((h) => ({ label: h.at.slice(0, 10), value: h.score }))}
        />
      </Section>
      {report.profileHistory.length === 0 ? null : (
        <Section title="Name and bio history">
          <table className={cn(table.root, lastRowOpen, "-mx-6 w-[calc(100%+3rem)]")}>
            <tbody>
              {report.profileHistory
                .toReversed()
                .slice(0, 20)
                .map((c) => (
                  <tr key={c.day} className={table.row}>
                    <td
                      className={cn(
                        table.td,
                        "w-28 font-mono text-2xs text-muted-foreground tabular-nums",
                      )}
                    >
                      {c.day}
                    </td>
                    <td className={cn(table.td, "w-48 font-medium")}>{c.name}</td>
                    <td className={cn(table.td, "max-w-0 truncate text-muted-foreground")}>
                      {c.bio}
                    </td>
                    <td className={cn(table.td, table.num, "w-20")}>{fmt(c.followers)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
