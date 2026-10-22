import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { AccountPost, CompetitorReport } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { competitorsAtom, fetchCompetitorAtom } from "../../state/analyze";
import { watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { Button } from "../ui/button";
import { Empty, ErrorText, errorText, fmt, inputClass, Section, Stat, usd } from "./ui";

/** One profile page plus one posts page. */
const FETCH_COST = 0.00022 + 0.00075;

function Report({ report, myAvg }: { report: CompetitorReport; myAvg: number }) {
  return (
    <>
      <div className="grid grid-cols-4 gap-x-4">
        <Stat label="Followers" value={fmt(report.profile?.followers ?? null)} />
        <Stat label="Posts" value={fmt(report.profile?.posts ?? null)} />
        <Stat label="Their avg views" value={fmt(report.avgViews)} />
        <Stat
          label="You vs them"
          value={report.avgViews === 0 ? "–" : `${((myAvg / report.avgViews) * 100).toFixed(0)}%`}
          sub={`your avg ${fmt(myAvg)}`}
        />
      </div>
      <ul className="flex flex-col gap-0.5 text-xs">
        {report.topPosts.map((p) => (
          <li key={p.postId} className="flex gap-2">
            <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
              {fmt(p.views)}
            </span>
            <a href={p.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
              {p.text}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Competitors({ posts }: { readonly posts: ReadonlyArray<AccountPost> }) {
  const watch = useAtomValue(watchListAtom);
  const refreshWatch = useAtomRefresh(watchListAtom);
  const reports = useAtomValue(competitorsAtom);
  const refreshReports = useAtomRefresh(competitorsAtom);
  const add = useAtomSet(watchAddAtom, { mode: "promise" });
  const remove = useAtomSet(watchRemoveAtom, { mode: "promise" });
  const fetchOne = useAtomSet(fetchCompetitorAtom, { mode: "promise" });
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const myAvg =
    posts.length === 0 ? 0 : posts.reduce((s, p) => s + (p.views ?? 0), 0) / posts.length;
  const byHandle = new Map(
    AsyncResult.getOrElse(reports, () => []).map((r) => [r.handle, r] as const),
  );

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
    <div className="flex flex-col gap-3">
      <Section title="Watch a handle">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const h = handle.trim().replace(/^@/, "");
            if (h === "") return;
            void run(() => add(h)).then(() => setHandle(""));
          }}
        >
          <input
            className={inputClass}
            placeholder="handle without @"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Button size="sm" type="submit" variant="outline">
            Add
          </Button>
        </form>
        <p className="pt-1 text-2xs text-muted-foreground">
          Adding is free. Fetching a handle costs {usd(FETCH_COST)}. The list is shared with Scores.
        </p>
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
      </Section>
      {AsyncResult.match(watch, {
        onInitial: () => <Empty>Loading…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <Empty>No handles watched yet.</Empty>
          ) : (
            value.map((w) => {
              const report = byHandle.get(w.handle);
              return (
                <Section
                  key={w.handle}
                  title={`@${w.handle}`}
                  actions={
                    <div className="flex gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void run(() => fetchOne(w.handle))}
                      >
                        {report === undefined ? "Fetch" : "Refetch"} ({usd(FETCH_COST)})
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={() => void run(() => remove(w.handle))}
                      >
                        Remove
                      </Button>
                    </div>
                  }
                >
                  {report === undefined ? (
                    <Empty>Not fetched yet.</Empty>
                  ) : (
                    <Report report={report} myAvg={myAvg} />
                  )}
                </Section>
              );
            })
          ),
      })}
    </div>
  );
}
