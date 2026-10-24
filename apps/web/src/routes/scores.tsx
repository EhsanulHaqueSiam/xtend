import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { Empty, ErrorText, errorText, Tabs } from "../components/analyze/ui";
import { PageHeader } from "../components/PageHeader";
import { HandlePicker, HandleReport } from "../components/scores/HandleReport";
import { Trending } from "../components/scores/Trending";
import { Watchlist } from "../components/scores/Watchlist";
import { parseHandle } from "../lib/utils";
import { settingsAtom } from "../state/settings";

const TABS = ["Mine", "Watchlist", "Report", "Trending", "Bot check"] as const;

function ScoresScreen({ wanted }: { readonly wanted: string | undefined }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(wanted === undefined ? "Mine" : "Report");
  const [picked, setPicked] = useState<string | null>(null);
  const settings = useAtomValue(settingsAtom);
  const handle = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.handle),
    () => null,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Scores" detail={handle === null ? "no handle set" : `@${handle}`} />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 overflow-y-auto px-4 py-3">
        {tab === "Mine" ? (
          AsyncResult.match(settings, {
            onInitial: () => <Empty>Connecting to the service…</Empty>,
            onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
            onSuccess: ({ value }) =>
              value.handle === null ? (
                <Empty>Set your X handle in Settings first.</Empty>
              ) : (
                <HandleReport handle={value.handle} />
              ),
          })
        ) : tab === "Watchlist" ? (
          picked === null ? (
            <Watchlist onOpen={setPicked} />
          ) : (
            <>
              <button
                type="button"
                className="w-fit cursor-pointer text-2xs text-muted-foreground hover:underline"
                onClick={() => setPicked(null)}
              >
                ← back to watchlist
              </button>
              <HandleReport handle={picked} />
            </>
          )
        ) : tab === "Report" ? (
          <HandlePicker initial={wanted ?? null} />
        ) : tab === "Trending" ? (
          <Trending />
        ) : (
          <HandlePicker botOnly />
        )}
      </div>
    </div>
  );
}

// Keyed by the handle: the palette opening another report while Scores is up only changes the search.
function ScoresRoute() {
  const { handle } = Route.useSearch();
  return <ScoresScreen key={handle ?? ""} wanted={handle} />;
}

export const Route = createFileRoute("/scores")({
  // The palette and the overlay open /scores?handle=<h> straight on a report. String(): the
  // router parses search values as JSON, so an all-digit handle arrives as a number.
  validateSearch: (s: Record<string, unknown>) => ({
    handle: s.handle === undefined ? undefined : parseHandle(String(s.handle))?.toLowerCase(),
  }),
  component: ScoresRoute,
});
