import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AccountPost, NonPublic, PostAnalytics, PostKind } from "@xtend/contracts";
import { useState } from "react";

import { fmtDay, fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { analyzeDataAtom, refreshNonPublicAtom } from "../../state/analyze";
import { usd, useRates } from "../../state/costs";
import { Button } from "../ui/button";
import { engagementRate, ErrorText, fmt, pct, Section, Stat } from "./ui";

const COLUMNS = ["date", "views", "likes", "replies", "reposts", "bookmarks", "er"] as const;
type Column = (typeof COLUMNS)[number];
/** X's private metrics, shown once the nightly job has rows. */
const PRIVATE_COLUMNS = ["impressions", "profileVisits", "linkClicks", "follows"] as const;
const PRIVATE_LABELS = {
  impressions: "impr",
  profileVisits: "visits",
  linkClicks: "clicks",
  follows: "follows",
};

const valueOf = (p: AccountPost, c: Column): number =>
  c === "date" ? new Date(p.createdAt).getTime() : c === "er" ? engagementRate(p) : (p[c] ?? 0);

const KINDS: ReadonlyArray<PostKind> = ["text", "media", "link", "reply", "thread"];
const DAY_MS = 86_400_000;

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
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    try {
      await refresh();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const last = nonPublic.lastRun;
  return (
    <Section
      title="Non-public metrics"
      actions={
        <Button size="xs" variant="outline" disabled={state.waiting} onClick={() => void run()}>
          {state.waiting
            ? "Fetching…"
            : `Fetch now (${rates === null ? "…" : usd(rates.readPage * posts30d)})`}
        </Button>
      }
    >
      <p className="text-2xs text-muted-foreground">
        {last === null
          ? "Runs nightly at 03:00 in your time zone. Impressions, profile visits, link clicks and follows per post need the treg X connection."
          : last.error === null
            ? `Last run ${fmtWhen(last.at)}: ${last.posts} posts.`
            : `Last run ${fmtWhen(last.at)} failed: needs the treg X connection (${last.error}).`}
      </p>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
    </Section>
  );
}

export function PostsTable({
  posts,
  nonPublic,
}: {
  readonly posts: ReadonlyArray<AccountPost>;
  readonly nonPublic: NonPublic;
}) {
  const [sort, setSort] = useState<Column>("date");
  const [desc, setDesc] = useState(true);
  const byEr = [...posts].sort((a, b) => engagementRate(b) - engagementRate(a));
  const best = new Set(byEr.slice(0, 5).map((p) => p.postId));
  // Never the same posts as the top 5: with fewer than 10 posts the best would also turn red.
  const worst = new Set(byEr.slice(Math.max(5, byEr.length - 5)).map((p) => p.postId));
  const sorted = [...posts].sort((a, b) => (valueOf(b, sort) - valueOf(a, sort)) * (desc ? 1 : -1));
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

  return (
    <div className="flex flex-col gap-3">
      <Section title="Average views by type">
        <div className="grid grid-cols-5 gap-x-4">
          {KINDS.map((kind) => {
            const of = posts.filter((p) => p.kind === kind);
            const avg =
              of.length === 0 ? 0 : of.reduce((s, p) => s + (p.views ?? 0), 0) / of.length;
            return <Stat key={kind} label={kind} value={fmt(avg)} sub={`${of.length} posts`} />;
          })}
        </div>
      </Section>
      <NonPublicStatus nonPublic={nonPublic} posts30d={posts30d} />
      {gained.length === 0 ? null : (
        <Section title="Posts that gained followers">
          <ul className="flex flex-col gap-0.5 text-xs">
            {gained.map((r) => (
              <li key={r.postId} className="flex gap-2">
                <span className="w-16 shrink-0 text-right font-mono">+{fmt(r.follows)}</span>
                <a
                  href={byId.get(r.postId)?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {byId.get(r.postId)?.text ?? r.postId}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`${posts.length} posts`}>
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Post</th>
              <th className="py-1 text-left font-normal">Type</th>
              {COLUMNS.map((c) => (
                <th key={c} className="py-1 text-right font-normal">
                  <button
                    type="button"
                    className={cn("cursor-pointer uppercase", c === sort && "text-foreground")}
                    onClick={() => toggle(c)}
                  >
                    {c}
                    {c === sort ? (desc ? " v" : " ^") : ""}
                  </button>
                </th>
              ))}
              {hasPrivate
                ? PRIVATE_COLUMNS.map((c) => (
                    <th key={c} className="py-1 text-right font-normal uppercase">
                      {PRIVATE_LABELS[c]}
                    </th>
                  ))
                : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.postId}
                className={cn(
                  "border-t border-border hover:bg-accent/60",
                  best.has(p.postId) && "text-success-foreground",
                  worst.has(p.postId) && "text-error-foreground",
                )}
              >
                <td className="max-w-xs truncate py-1 pr-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {p.text || "(no text)"}
                  </a>
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{p.kind}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">
                  {fmtDay(p.createdAt)}
                </td>
                <td className="py-1 text-right font-mono">{fmt(p.views)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.likes)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.replies)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.reposts)}</td>
                <td className="py-1 text-right font-mono">{fmt(p.bookmarks)}</td>
                <td className="py-1 text-right font-mono">{pct(engagementRate(p))}</td>
                {hasPrivate
                  ? PRIVATE_COLUMNS.map((c) => (
                      <td key={c} className="py-1 text-right font-mono">
                        {fmt(privateByPost.get(p.postId)?.[c satisfies keyof PostAnalytics])}
                      </td>
                    ))
                  : null}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-2 text-2xs text-muted-foreground">
          Green: top 5 by engagement rate. Red: bottom 5. Click a post to open it on x.com.
        </p>
      </Section>
    </div>
  );
}
