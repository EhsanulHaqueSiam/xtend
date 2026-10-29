import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ScoreChange, WatchEntry } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { X } from "lucide-react";
import { useState } from "react";

import { fmtDay } from "../../lib/time";
import { cn, NOT_A_HANDLE, parseHandle } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { runScoreAtom, watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Cost, Empty, PageBody, table } from "../ui/layout";
import { xIconButton, xPill, xPillSm } from "../x";
import { ErrorLine, causeMessage, errorMessage, fmt } from "../library/shared";

const WINDOWS = ["d1", "d7", "d14", "d30"] as const satisfies ReadonlyArray<keyof ScoreChange>;

function ScoreButton({
  handle,
  label,
  disabled,
  onClick,
}: {
  readonly handle: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const quote = useQuoteLabel({ kind: "scoreRun", handle });
  return (
    <button
      type="button"
      className={cn(xPill, "h-6 gap-1 px-2 text-xs")}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
      <Cost label={quote} />
    </button>
  );
}

function Change({ value }: { readonly value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(value > 0 && "text-success-foreground", value < 0 && "text-error-foreground")}
    >
      {value > 0 ? "+" : ""}
      {fmt(value)}
    </span>
  );
}

const sorted = (rows: ReadonlyArray<WatchEntry>, by: keyof ScoreChange | null) =>
  by === null
    ? rows
    : rows.toSorted((a, b) => (b.change[by] ?? -Infinity) - (a.change[by] ?? -Infinity));

/** Watched handles with score, tier and change over 1 to 30 days, sortable by any window. */
export function Watchlist({ onOpen }: { readonly onOpen: (handle: string) => void }) {
  const watch = useAtomValue(watchListAtom);
  const refreshWatch = useAtomRefresh(watchListAtom);
  const add = useAtomSet(watchAddAtom, { mode: "promise" });
  const remove = useAtomSet(watchRemoveAtom, { mode: "promise" });
  const score = useAtomSet(runScoreAtom, { mode: "promise" });
  const scoreState = useAtomValue(runScoreAtom);
  const [handle, setHandle] = useState("");
  const [sortBy, setSortBy] = useState<keyof ScoreChange | null>(null);
  const [error, setError] = useState<string | null>(null);

  // True when the work succeeded, so the add form only clears what actually went in.
  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      refreshWatch();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const count = AsyncResult.getOrElse(
    AsyncResult.map(watch, (rows) => rows.length),
    () => null,
  );

  return (
    <>
      <PageHeader
        title="Watchlist"
        detail={count === null || count === 0 ? undefined : `${count} watched`}
        actions={
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (handle.trim() === "") return;
              const h = parseHandle(handle);
              if (h === null) return setError(NOT_A_HANDLE);
              void run(() => add(h)).then((ok) => ok && setHandle(""));
            }}
          >
            <input
              className={cn(compactInputClass, "w-40 font-mono @max-[40rem]:w-28")}
              aria-label="Handle to watch"
              placeholder="@handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <button type="submit" className={cn(xPill, xPillSm)} disabled={handle.trim() === ""}>
              Watch
              <Cost usd={0} />
            </button>
          </form>
        }
      />
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <PageBody>
        {AsyncResult.match(watch, {
          onInitial: () => <Empty>Loading the watchlist</Empty>,
          onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
          onSuccess: ({ value }) =>
            value.length === 0 ? (
              <Empty>
                Watch a handle to see its score move over 1, 7, 14 and 30 days. Watching is free.
              </Empty>
            ) : (
              <table className={table.root}>
                <thead>
                  <tr>
                    <th className={table.th}>Handle</th>
                    <th className={cn(table.th, "text-right")}>Score</th>
                    <th className={table.th}>Tier</th>
                    {WINDOWS.map((w) => (
                      <th key={w} className={cn(table.th, "text-right")}>
                        <button
                          type="button"
                          // Starts with the visible "7d" so voice control can say what it shows.
                          aria-label={`${w.slice(1)}d, sort by ${w.slice(1)} day change`}
                          className={cn(
                            "cursor-pointer transition-colors duration-150 hover:text-foreground",
                            w === sortBy && "text-foreground",
                          )}
                          onClick={() => setSortBy((s) => (s === w ? null : w))}
                        >
                          {w.slice(1)}d{w === sortBy ? " ↓" : ""}
                        </button>
                      </th>
                    ))}
                    <th className={cn(table.th, "text-right @max-[44rem]:hidden")}>Added</th>
                    <th className={table.th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted(value, sortBy).map((w) => (
                    <tr key={w.handle} className={table.row}>
                      <td className={table.td}>
                        <button
                          type="button"
                          className="cursor-pointer font-medium hover:underline"
                          onClick={() => onOpen(w.handle)}
                        >
                          @{w.handle}
                        </button>
                      </td>
                      <td className={cn(table.td, table.num)}>{fmt(w.score)}</td>
                      <td className={cn(table.td, "text-xs text-muted-foreground")}>
                        {w.tier ?? "–"}
                      </td>
                      {WINDOWS.map((k) => (
                        <td key={k} className={cn(table.td, table.num)}>
                          <Change value={w.change[k]} />
                        </td>
                      ))}
                      <td
                        className={cn(
                          table.td,
                          table.num,
                          "text-muted-foreground @max-[44rem]:hidden",
                        )}
                      >
                        {fmtDay(w.addedAt)}
                      </td>
                      <td className={table.td}>
                        <div className="flex items-center justify-end gap-1">
                          <ScoreButton
                            handle={w.handle}
                            label={w.score === null ? "Score" : "Rescore"}
                            disabled={scoreState.waiting}
                            onClick={() => void run(() => score({ handle: w.handle }))}
                          />
                          <button
                            type="button"
                            aria-label={`Stop watching @${w.handle}`}
                            title="Stop watching"
                            className={cn(xIconButton, "size-6 [&_svg]:size-3.5")}
                            onClick={() => void run(() => remove(w.handle))}
                          >
                            <X />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
        })}
      </PageBody>
    </>
  );
}
