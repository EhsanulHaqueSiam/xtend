import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { NOT_A_HANDLE, parseHandle } from "../../lib/utils";
import { usd, useQuoteLabel, useRates } from "../../state/costs";
import { reportAtom, runScoreAtom } from "../../state/scores";
import { Empty, ErrorText, errorText, inputClass } from "../analyze/ui";
import { Button } from "../ui/button";
import { ReportCard } from "./ReportCard";

/** Stored report for one handle plus the paid "Score" button. */
export function HandleReport({
  handle,
  botOnly,
}: {
  readonly handle: string;
  readonly botOnly?: boolean;
}) {
  const report = useAtomValue(reportAtom(handle));
  const refresh = useAtomRefresh(reportAtom(handle));
  const run = useAtomSet(runScoreAtom, { mode: "promise" });
  const runState = useAtomValue(runScoreAtom);
  const defaultQuote = useQuoteLabel({ kind: "scoreRun", handle });
  const rates = useRates();
  const [pages, setPages] = useState(5);
  const [error, setError] = useState<string | null>(null);
  // The service only quotes the default run; other page counts are priced from its rate card.
  const quote =
    pages === 5 || rates === null
      ? defaultQuote
      : usd(rates.scraperProfile + pages * rates.followersPage);

  const score = async () => {
    setError(null);
    try {
      await run({ handle, pages });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const button = (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 font-mono text-2xs text-muted-foreground">
        <input
          type="range"
          min={1}
          max={10}
          value={pages}
          aria-label="Follower pages"
          onChange={(e) => setPages(Number(e.target.value))}
        />
        {pages} pages
      </label>
      <Button size="xs" variant="outline" disabled={runState.waiting} onClick={() => void score()}>
        {runState.waiting ? "Scoring…" : `Score (${quote})`}
      </Button>
    </div>
  );

  return (
    <>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {AsyncResult.match(report, {
        onInitial: () => <Empty>Loading…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) => (
          <ReportCard report={value} actions={button} botOnly={botOnly ?? false} />
        ),
      })}
    </>
  );
}

/** Handle input that renders HandleReport once submitted, or straight away for `initial`. */
export function HandlePicker({
  botOnly,
  initial = null,
}: {
  readonly botOnly?: boolean;
  readonly initial?: string | null;
}) {
  const [draft, setDraft] = useState(initial ?? "");
  const [handle, setHandle] = useState<string | null>(initial);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() === "") return;
          const h = parseHandle(draft);
          setInvalid(h === null);
          if (h !== null) setHandle(h);
        }}
      >
        <input
          className={inputClass}
          placeholder="handle without @"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button size="sm" type="submit" variant="outline">
          Open
        </Button>
      </form>
      {invalid ? <ErrorText>{NOT_A_HANDLE}</ErrorText> : null}
      <p className="text-2xs text-muted-foreground">
        Opening is free and shows stored samples. Scoring reads the profile and the follower pages
        on the slider; the button shows the price.
      </p>
      {handle === null ? null : (
        // Keyed: the last handle's error and page count are not this one's.
        <HandleReport key={handle} handle={handle} botOnly={botOnly ?? false} />
      )}
    </div>
  );
}
