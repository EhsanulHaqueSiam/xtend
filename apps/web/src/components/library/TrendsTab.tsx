import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { TrendIdea } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Copy, Sparkles } from "lucide-react";
import { useState } from "react";

import { saveSuggestedDraftAtom, trendIdeasAtom, trendsAtom } from "../../state/library";
import { Button } from "../ui/button";
import { useQuoteLabel } from "../../state/costs";
import { TREND_COUNTRIES } from "../scores/Trending";
import { Empty, ErrorLine, errorMessage, fmt, inputClass } from "./shared";

function IdeaRow({ idea }: { readonly idea: TrendIdea }) {
  const saveDraft = useAtomSet(saveSuggestedDraftAtom, { mode: "promise" });
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-medium">{idea.trend}</span>
        <span className="text-muted-foreground">{idea.angle}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{idea.text}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void navigator.clipboard.writeText(idea.text).then(() => setStatus("Copied"))
          }
        >
          <Copy /> Copy
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            void saveDraft({ text: idea.text, source: `trend:${idea.trend}` })
              .then(({ id }) => setStatus(`Suggested draft #${id}`))
              .catch((e: unknown) => setStatus(errorMessage(e)))
          }
        >
          Save as draft
        </Button>
        {status !== null ? <span className="text-2xs text-muted-foreground">{status}</span> : null}
      </div>
    </div>
  );
}

/** Mounted only after Load: reading the atom is the paid call. */
function TrendList({ country }: { readonly country: string }) {
  const trends = useAtomValue(trendsAtom(country));
  return AsyncResult.match(trends, {
    onInitial: () => <Empty>Loading trends…</Empty>,
    onFailure: (f) => <ErrorLine>{String(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) => (
      <ol className="flex flex-col divide-y divide-border">
        {value.slice(0, 30).map((t, i) => (
          <li key={t.name} className="flex items-baseline gap-2 py-1.5 text-sm">
            <span className="w-5 font-mono text-2xs text-muted-foreground">{i + 1}</span>
            <span className="truncate">{t.name}</span>
            <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
              {t.postCount === null ? (t.context ?? "") : `${fmt(t.postCount)} posts`}
            </span>
          </li>
        ))}
      </ol>
    ),
  });
}

export function TrendsTab() {
  const [country, setCountry] = useState<string>(TREND_COUNTRIES[0]);
  const trendsQuote = useQuoteLabel({ kind: "trending", country });
  const [applied, setApplied] = useState<string | null>(null);
  const ideasFor = useAtomSet(trendIdeasAtom, { mode: "promise" });
  const [ideas, setIdeas] = useState<ReadonlyArray<TrendIdea> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (applied === null) return;
    setBusy(true);
    setError(null);
    try {
      setIdeas(await ideasFor(applied));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex items-center gap-2 border-b border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(country);
        }}
      >
        <select
          className={`${inputClass} max-w-48`}
          aria-label="Country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {TREND_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Load trends ({trendsQuote})
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy || applied === null}
          onClick={() => void generate()}
        >
          <Sparkles /> Ideas from trends (model call)
        </Button>
      </form>
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="flex min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-3 py-3 md:grid-cols-[1fr_1.4fr]">
          <div>
            {applied === null ? (
              <p className="text-sm text-muted-foreground">
                Load the trends for a country. Cached for 30 minutes.
              </p>
            ) : (
              <TrendList country={applied} />
            )}
          </div>
          <div className="flex flex-col gap-2">
            {ideas === null ? (
              <p className="text-sm text-muted-foreground">
                Generate 5 post ideas tied to the trends that fit your keywords.
              </p>
            ) : (
              ideas.map((idea) => <IdeaRow key={`${idea.trend}:${idea.angle}`} idea={idea} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
