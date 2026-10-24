import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { Ask } from "../components/analyze/Ask";
import { Audience } from "../components/analyze/Audience";
import { BestTime } from "../components/analyze/BestTime";
import { Competitors } from "../components/analyze/Competitors";
import { Overview } from "../components/analyze/Overview";
import { PostsTable } from "../components/analyze/PostsTable";
import { Empty, ErrorText, errorText, Tabs } from "../components/analyze/ui";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { fmtWhen } from "../lib/time";
import { analyzeDataAtom, refreshAnalyzeAtom } from "../state/analyze";
import { useQuoteLabel } from "../state/costs";

const TABS = ["Overview", "Posts", "Audience", "Best time", "Competitors", "Ask"] as const;

function AnalyzeScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const data = useAtomValue(analyzeDataAtom);
  const refreshData = useAtomRefresh(analyzeDataAtom);
  const refresh = useAtomSet(refreshAnalyzeAtom, { mode: "promise" });
  const refreshState = useAtomValue(refreshAnalyzeAtom);
  const refreshQuote = useQuoteLabel({ kind: "analyzeRefresh" });
  const [error, setError] = useState<string | null>(null);
  const fetchedAt = AsyncResult.getOrElse(
    AsyncResult.map(data, (d) => d.fetchedAt),
    () => null,
  );

  const runRefresh = async () => {
    setError(null);
    try {
      await refresh();
      refreshData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Analyze"
        detail={fetchedAt === null ? "no posts loaded" : `posts as of ${fmtWhen(fetchedAt)}`}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={refreshState.waiting}
            onClick={() => void runRefresh()}
          >
            {refreshState.waiting ? "Refreshing…" : `Refresh posts (${refreshQuote})`}
          </Button>
        }
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 overflow-y-auto px-4 py-3">
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
        {AsyncResult.match(data, {
          onInitial: () => <Empty>Connecting to the service…</Empty>,
          onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
          onSuccess: ({ value }) =>
            value.handle === null ? (
              <Empty>Set your X handle in Settings first.</Empty>
            ) : tab === "Overview" ? (
              <Overview data={value} />
            ) : tab === "Posts" ? (
              <PostsTable posts={value.posts} nonPublic={value.nonPublic} />
            ) : tab === "Audience" ? (
              <Audience posts={value.posts} />
            ) : tab === "Best time" ? (
              <BestTime heatmap={value.heatmap} zone={value.timeZone} />
            ) : tab === "Competitors" ? (
              <Competitors posts={value.posts} nonPublic={value.nonPublic} />
            ) : (
              <Ask />
            ),
        })}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/analyze")({ component: AnalyzeScreen });
