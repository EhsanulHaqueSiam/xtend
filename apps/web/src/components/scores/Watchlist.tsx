import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { useQuoteLabel } from "../../state/costs";
import { runScoreAtom, watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { Empty, ErrorText, errorText, fmt, inputClass, Section, signed } from "../analyze/ui";
import { Button } from "../ui/button";

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

/** Watched handles with score, tier and 7-day change; shared with Analyze's Competitors tab. */
export function Watchlist({ onOpen }: { readonly onOpen: (handle: string) => void }) {
  const watch = useAtomValue(watchListAtom);
  const refreshWatch = useAtomRefresh(watchListAtom);
  const add = useAtomSet(watchAddAtom, { mode: "promise" });
  const remove = useAtomSet(watchRemoveAtom, { mode: "promise" });
  const score = useAtomSet(runScoreAtom, { mode: "promise" });
  const scoreState = useAtomValue(runScoreAtom);
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      refreshWatch();
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
                  <th className="py-1 text-right font-normal">7d</th>
                  <th className="py-1 text-right font-normal">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {value.map((w) => (
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
                    <td className="py-1 text-right font-mono text-2xs">
                      {w.change7d === null ? "–" : signed(w.change7d)}
                    </td>
                    <td className="py-1 text-right font-mono text-2xs text-muted-foreground">
                      {w.addedAt.slice(0, 10)}
                    </td>
                    <td className="py-1 text-right">
                      <div className="flex justify-end gap-1">
                        <ScoreButton
                          handle={w.handle}
                          label={w.score === null ? "Score" : "Rescore"}
                          disabled={scoreState.waiting}
                          onClick={() => void run(() => score(w.handle))}
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
