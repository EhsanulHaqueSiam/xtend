import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { reportAtom, RUN_COST, runScoreAtom } from "../../state/scores";
import { Empty, ErrorText, errorText, inputClass, usd } from "../analyze/ui";
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
  const [error, setError] = useState<string | null>(null);

  const score = async () => {
    setError(null);
    try {
      await run(handle);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const button = (
    <Button size="xs" variant="outline" disabled={runState.waiting} onClick={() => void score()}>
      {runState.waiting ? "Scoring…" : `Score (${usd(RUN_COST)})`}
    </Button>
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

/** Handle input that renders HandleReport once submitted. */
export function HandlePicker({ botOnly }: { readonly botOnly?: boolean }) {
  const [draft, setDraft] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const h = draft.trim().replace(/^@/, "");
          if (h !== "") setHandle(h);
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
      <p className="text-2xs text-muted-foreground">
        Opening is free and shows stored samples. Scoring reads the profile and up to 5 follower
        pages for {usd(RUN_COST)}.
      </p>
      {handle === null ? null : <HandleReport handle={handle} botOnly={botOnly ?? false} />}
    </div>
  );
}
