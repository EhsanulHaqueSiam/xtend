import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ScoreChange } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { useQuoteLabel } from "../../state/costs";
import { runScoreAtom, watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { fmtDay } from "../../lib/time";
import { cn, NOT_A_HANDLE, parseHandle } from "../../lib/utils";
import { Empty, ErrorText, errorText, fmt, inputClass, Section, signed } from "../analyze/ui";
import { Button } from "../ui/button";

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
    <Button size="micro" variant="outline" disabled={disabled} onClick={onClick}>
      {label} ({quote})
    </Button>
  );
}

/** Watched handles with score, tier and change over 1 to 30 days, sortable by any window; shared with Analyze's Competitors tab. */
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
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Section title="Watch a handle">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (handle.trim() === "") return;
            const h = parseHandle(handle);
            if (h === null) return setError(NOT_A_HANDLE);
            void run(() => add(h)).then((ok) => ok && setHandle(""));
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
          Adding is free. Scoring a handle reads its profile and up to 5 follower pages.
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
            <table className="w-full text-xs">
              <thead className="text-2xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-1 text-left font-normal">Handle</th>
                  <th className="py-1 text-right font-normal">Score</th>
                  <th className="py-1 text-left font-normal pl-3">Tier</th>
                  {WINDOWS.map((w) => (
                    <th key={w} className="py-1 text-right font-normal">
                      <button
                        type="button"
                        className={cn("cursor-pointer", w === sortBy && "text-foreground")}
                        onClick={() => setSortBy((s) => (s === w ? null : w))}
                      >
                        {w.slice(1)}d{w === sortBy ? " v" : ""}
                      </button>
                    </th>
                  ))}
                  <th className="py-1 text-right font-normal">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(sortBy === null
                  ? value
                  : [...value].sort(
                      (a, b) => (b.change[sortBy] ?? -Infinity) - (a.change[sortBy] ?? -Infinity),
                    )
                ).map((w) => (
                  <tr key={w.handle} className="border-b border-border/50">
                    <td className="py-1">
                      <button
                        type="button"
                        className="cursor-pointer hover:underline"
                        onClick={() => onOpen(w.handle)}
                      >
                        @{w.handle}
                      </button>
                    </td>
                    <td className="py-1 text-right font-mono text-2xs">{fmt(w.score)}</td>
                    <td className="py-1 pl-3 font-mono text-2xs">{w.tier ?? "–"}</td>
                    {WINDOWS.map((k) => (
                      <td key={k} className="py-1 text-right font-mono text-2xs">
                        {w.change[k] === null ? "–" : signed(w.change[k])}
                      </td>
                    ))}
                    <td className="py-1 text-right font-mono text-2xs text-muted-foreground">
                      {fmtDay(w.addedAt)}
                    </td>
                    <td className="py-1 text-right">
                      <div className="flex justify-end gap-1">
                        <ScoreButton
                          handle={w.handle}
                          label={w.score === null ? "Score" : "Rescore"}
                          disabled={scoreState.waiting}
                          onClick={() => void run(() => score({ handle: w.handle }))}
                        />
                        <Button
                          size="micro"
                          variant="ghost-muted"
                          onClick={() => void run(() => remove(w.handle))}
                        >
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ),
      })}
    </div>
  );
}
