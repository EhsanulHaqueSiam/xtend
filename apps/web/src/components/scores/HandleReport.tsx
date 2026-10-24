import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn, NOT_A_HANDLE, parseHandle } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import { reportAtom, runScoreAtom } from "../../state/scores";
import { settingsAtom } from "../../state/settings";
import { PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Cost, Empty, PageBody } from "../ui/layout";
import { NoHandle } from "../ui/no-handle";
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
      <label className="flex items-center gap-2 font-mono text-2xs text-muted-foreground tabular-nums">
        <input
          type="range"
          min={1}
          max={10}
          value={pages}
          aria-label="Follower pages"
          className="w-20 cursor-pointer accent-foreground"
          onChange={(e) => setPages(Number(e.target.value))}
        />
        <span className="w-14">{pages} pages</span>
      </label>
      <button
        type="button"
        className={cn(xPill, xPillSm)}
        disabled={runState.waiting}
        onClick={() => void score()}
      >
        {runState.waiting ? "Scoring" : "Score"}
        {/* The service quotes the default run; other page counts are priced from its rate card. */}
        {pages === DEFAULT_PAGES || rates === null ? (
          <Cost label={defaultQuote} />
        ) : (
          <Cost usd={rates.scraperProfile + pages * rates.followersPage} />
        )}
      </button>
    </div>
  );
}

/** The stored report for one handle (free) with the paid score run beside the score. */
function HandleReport({
  handle,
  botOnly = false,
}: {
  readonly handle: string;
  readonly botOnly?: boolean;
}) {
  const report = useAtomValue(reportAtom(handle));
  const refresh = useAtomRefresh(reportAtom(handle));
  return AsyncResult.match(report, {
    onInitial: () => <Empty>Loading @{handle}</Empty>,
    onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) => (
      <ReportCard
        report={value}
        botOnly={botOnly}
        actions={<ScoreControls handle={handle} onScored={refresh} />}
      />
    ),
  });
}

/** The user's own score; the handle comes from the signed-in X session. */
export function MineSection() {
  const settings = useAtomValue(settingsAtom);
  const handle = AsyncResult.getOrElse(
    AsyncResult.map(settings, (s) => s.handle),
    () => null,
  );
  return (
    <>
      <PageHeader title="Mine" detail={handle === null ? undefined : `@${handle}`} />
      <PageBody>
        {AsyncResult.match(settings, {
          onInitial: () => <Empty>Connecting to the service</Empty>,
          onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
          onSuccess: ({ value }) =>
            value.handle === null ? (
              <NoHandle subject="Your own score needs" />
            ) : (
              <HandleReport handle={value.handle} />
            ),
        })}
      </PageBody>
    </>
  );
}

/**
 * Any handle's report, or just its bot check. The handle lives in the URL
 * (`?handle=`), so the palette, the overlay and the watchlist can open one.
 */
export function ReportSection({
  handle,
  botOnly = false,
}: {
  readonly handle: string | undefined;
  readonly botOnly?: boolean;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(handle ?? "");
  const [invalid, setInvalid] = useState(false);
  const tab = botOnly ? "bot-check" : "report";
  return (
    <>
      <PageHeader
        title={botOnly ? "Bot check" : "Report"}
        actions={
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim() === "") return;
              const h = parseHandle(draft)?.toLowerCase() ?? null;
              setInvalid(h === null);
              if (h !== null)
                void navigate({ href: `/scores?tab=${tab}&handle=${encodeURIComponent(h)}` });
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
        {handle === undefined ? (
          <Empty>
            {botOnly
              ? "Open a handle to see how many of its sampled followers look fake."
              : "Open a handle to read its stored score and who its top followers are."}
          </Empty>
        ) : (
          <HandleReport key={handle} handle={handle} botOnly={botOnly} />
        )}
      </PageBody>
    </>
  );
}
