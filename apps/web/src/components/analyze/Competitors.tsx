import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AnalyzeData, CompetitorReport } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Fragment, useState } from "react";

import { cn } from "../../lib/utils";
import { competitorsAtom, fetchCompetitorAtom } from "../../state/analyze";
import { useQuoteLabel } from "../../state/costs";
import { watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { Button } from "../ui/button";
import { Cost, Empty, table } from "../ui/layout";
import { AnalyzePage } from "./AnalyzePage";
import { ErrorBar, errorText, fieldClass, fmt, when, XLink } from "./ui";

function FetchButton({
  handle,
  label,
  onClick,
}: {
  readonly handle: string;
  readonly label: string;
  readonly onClick: () => void;
}) {
  const quote = useQuoteLabel({ kind: "competitorFetch", handle });
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {label} <Cost label={quote} />
    </Button>
  );
}

/** A fetched handle's top posts, under its row. */
function TopPosts({ report }: { readonly report: CompetitorReport }) {
  return report.topPosts.length === 0 ? (
    <p className="py-2 text-xs text-muted-foreground">No posts in the fetched page.</p>
  ) : (
    <ul className="flex flex-col py-1 text-[13px]">
      {report.topPosts.map((p) => (
        <li key={p.postId} className="flex gap-3 py-1">
          <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
            {fmt(p.views)}
          </span>
          <XLink href={p.url} className="min-w-0 truncate text-foreground/90">
            {p.text}
          </XLink>
        </li>
      ))}
    </ul>
  );
}

/** Watched handles side by side with you; a row opens its top posts. The list is shared with Scores. */
export function Competitors({ data }: { readonly data: AnalyzeData }) {
  const { posts, nonPublic } = data;
  const watch = useAtomValue(watchListAtom);
  const refreshWatch = useAtomRefresh(watchListAtom);
  const reports = useAtomValue(competitorsAtom);
  const refreshReports = useAtomRefresh(competitorsAtom);
  const add = useAtomSet(watchAddAtom, { mode: "promise" });
  const remove = useAtomSet(watchRemoveAtom, { mode: "promise" });
  const fetchOne = useAtomSet(fetchCompetitorAtom, { mode: "promise" });
  const [handle, setHandle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const myAvg =
    posts.length === 0 ? 0 : posts.reduce((s, p) => s + (p.views ?? 0), 0) / posts.length;
  // Only own posts have impressions; they are the honest side of the comparison when present.
  const myImpressions =
    nonPublic.byPost.length === 0
      ? null
      : nonPublic.byPost.reduce((s, r) => s + r.impressions, 0) / nonPublic.byPost.length;
  const mine = myImpressions ?? myAvg;
  const byHandle = new Map(
    AsyncResult.getOrElse(reports, () => []).map((r) => [r.handle, r] as const),
  );
  const watched = AsyncResult.getOrElse(watch, () => []);

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      refreshWatch();
      refreshReports();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AnalyzePage
      data={data}
      detail={watched.length === 0 ? undefined : `${watched.length} watched`}
      actions={
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const h = handle.trim().replace(/^@/, "");
            if (h === "") return;
            void run(() => add(h)).then(() => setHandle(""));
          }}
        >
          <input
            aria-label="Handle to watch"
            className={cn(fieldClass, "w-36 font-mono")}
            placeholder="@handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Button size="sm" type="submit" variant="outline">
            Watch <Cost usd={0} />
          </Button>
        </form>
      }
    >
      <ErrorBar>{error}</ErrorBar>
      {AsyncResult.match(watch, {
        onInitial: () => <Empty>Loading.</Empty>,
        onFailure: (f) => (
          <Empty>
            <span className="text-error-foreground">{errorText(f.cause)}</span>
          </Empty>
        ),
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <Empty>No handles watched. Watching is free; the list is shared with Scores.</Empty>
          ) : (
            <table className={table.root}>
              <thead>
                <tr>
                  <th className={table.th}>Handle</th>
                  <th className={cn(table.th, "text-right")}>Followers</th>
                  <th className={cn(table.th, "hidden text-right @3xl:table-cell")}>Posts</th>
                  <th className={cn(table.th, "text-right")}>Avg views</th>
                  <th
                    className={cn(table.th, "text-right")}
                    title={
                      myImpressions === null
                        ? `Your average ${fmt(myAvg)} views over theirs`
                        : `Your average ${fmt(myImpressions)} impressions over their views`
                    }
                  >
                    You vs them
                  </th>
                  <th className={cn(table.th, "hidden @4xl:table-cell")}>Fetched</th>
                  <th className={table.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {value.map((w) => {
                  const report = byHandle.get(w.handle);
                  const ratio =
                    report === undefined || report.avgViews === 0 ? null : mine / report.avgViews;
                  const expanded = open === w.handle && report !== undefined;
                  return (
                    <Fragment key={w.handle}>
                      <tr
                        data-selected={expanded}
                        aria-expanded={report === undefined ? undefined : expanded}
                        className={cn(table.row, report !== undefined && "cursor-pointer")}
                        onClick={() =>
                          report !== undefined && setOpen(open === w.handle ? null : w.handle)
                        }
                      >
                        <td className={cn(table.td, "font-mono text-xs")}>@{w.handle}</td>
                        <td className={cn(table.td, table.num)}>
                          {fmt(report?.profile?.followers ?? null)}
                        </td>
                        <td className={cn(table.td, table.num, "hidden @3xl:table-cell")}>
                          {fmt(report?.profile?.posts ?? null)}
                        </td>
                        <td className={cn(table.td, table.num)}>
                          {report === undefined ? "–" : fmt(report.avgViews)}
                        </td>
                        <td
                          className={cn(
                            table.td,
                            table.num,
                            ratio !== null && ratio >= 1 && "text-success-foreground",
                            ratio !== null && ratio < 1 && "text-error-foreground",
                          )}
                        >
                          {ratio === null ? "–" : `${(ratio * 100).toFixed(0)}%`}
                        </td>
                        <td
                          className={cn(
                            table.td,
                            "hidden font-mono text-xs whitespace-nowrap text-muted-foreground @4xl:table-cell",
                          )}
                        >
                          {report === undefined ? "not yet" : when(report.fetchedAt)}
                        </td>
                        <td className={cn(table.td, "whitespace-nowrap")}>
                          <div className="flex justify-end gap-1.5">
                            <FetchButton
                              handle={w.handle}
                              label={report === undefined ? "Fetch" : "Refetch"}
                              onClick={() => void run(() => fetchOne(w.handle))}
                            />
                            <Button
                              size="sm"
                              variant="ghost-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                void run(() => remove(w.handle));
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && report !== undefined ? (
                        <tr>
                          <td colSpan={7} className="border-b border-border px-6 py-1">
                            <TopPosts report={report} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ),
      })}
    </AnalyzePage>
  );
}
