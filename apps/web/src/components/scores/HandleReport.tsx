import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn, NOT_A_HANDLE, parseHandle } from "../../lib/utils";
import { usd, useQuoteLabel, useRates } from "../../state/costs";
import { reportAtom, runScoreAtom } from "../../state/scores";
import { settingsAtom } from "../../state/settings";
import { PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Select } from "../ui/select";
import { Cost, Empty, PageBody } from "../ui/layout";
import { xPill, xPillSm } from "../x";
import { ErrorLine, causeMessage, errorMessage } from "../library/shared";
import { ReportCard } from "./ReportCard";

const DEFAULT_PAGES = 5;

/** The paid run: follower pages on a slider, the price for that many, then the run. */
function ScoreControls({
  handle,
  onScored,
}: {
  readonly handle: string;
  readonly onScored: () => void;
}) {
  const run = useAtomSet(runScoreAtom, { mode: "promise" });
  const runState = useAtomValue(runScoreAtom);
  const defaultQuote = useQuoteLabel({ kind: "scoreRun", handle });
  const rates = useRates();
  const [pages, setPages] = useState(DEFAULT_PAGES);
  const [error, setError] = useState<string | null>(null);
  // The service quotes the default run; other page counts are priced from its rate card.
  const price =
    pages === DEFAULT_PAGES
      ? defaultQuote
      : rates === null
        ? "…"
        : usd(rates.scraperProfile + pages * rates.followersPage);

  const score = async () => {
    setError(null);
    try {
      await run({ handle, pages });
      onScored();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {error !== null ? (
        <span className="max-w-64 truncate text-2xs text-error-foreground" title={error}>
          {error}
        </span>
      ) : null}
      <Select
        compact
        label="Follower pages"
        value={pages}
        onChange={setPages}
        options={Array.from({ length: 10 }, (_, i) => ({
          value: i + 1,
          label: i === 0 ? "1 follower page" : `${i + 1} follower pages`,
        }))}
      />
      <button
        type="button"
        className={cn(xPill, xPillSm)}
        disabled={runState.waiting || price === "…"}
        onClick={() => void score()}
      >
        {runState.waiting ? "Scoring" : "Score"}
        <Cost label={price} />
      </button>
    </div>
  );
}

/** The stored report for one handle (free) with the paid score run beside the score. */
function HandleReport({ handle }: { readonly handle: string }) {
  const report = useAtomValue(reportAtom(handle));
  const refresh = useAtomRefresh(reportAtom(handle));
  return AsyncResult.match(report, {
    onInitial: () => <Empty>Loading @{handle}</Empty>,
    onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) => (
      <ReportCard report={value} actions={<ScoreControls handle={handle} onScored={refresh} />} />
    ),
  });
}

/**
 * One account's report in full, bot check included: yours until another handle is opened.
 * The handle lives in the URL (`?handle=`), so the palette, the overlay and the watchlist
 * can open one.
 */
export function ReportSection({ handle }: { readonly handle: string | undefined }) {
  const navigate = useNavigate();
  const own = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(settingsAtom), (s) => s.handle),
    () => null,
  );
  const shown = handle ?? own ?? undefined;
  const [draft, setDraft] = useState(handle ?? "");
  const [invalid, setInvalid] = useState(false);
  return (
    <>
      <PageHeader
        title="Report"
        detail={shown !== undefined && shown === own ? "yours" : undefined}
        actions={
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() === "") return;
              const h = parseHandle(draft)?.toLowerCase() ?? null;
              setInvalid(h === null);
              if (h !== null)
                void navigate({ href: `/scores?tab=report&handle=${encodeURIComponent(h)}` });
            }}
          >
            <input
              className={cn(compactInputClass, "w-44 font-mono @max-[40rem]:w-32")}
              aria-label="Handle"
              placeholder="@handle"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className={cn(xPill, xPillSm)}>
              Open
              <Cost usd={0} />
            </button>
          </form>
        }
      />
      {invalid ? <ErrorLine>{NOT_A_HANDLE}</ErrorLine> : null}
      <PageBody>
        {shown === undefined ? (
          <Empty>
            Open a handle to read its stored score, who its top followers are and how many look
            fake. Opening is free; a new score is priced on its button.
          </Empty>
        ) : (
          <HandleReport key={shown} handle={shown} />
        )}
      </PageBody>
    </>
  );
}
