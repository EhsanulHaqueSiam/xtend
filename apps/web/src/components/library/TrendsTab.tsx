import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { TrendIdea } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { saveSuggestedDraftAtom, trendIdeasAtom, trendsAtom } from "../../state/library";
import { PageHeader } from "../PageHeader";
import { CountrySelect, TREND_COUNTRIES, TrendTable, countryLabel } from "../scores/Trending";
import { Cost, Empty, PageBody } from "../ui/layout";
import { xPill, xPillSm } from "../x";
import { ErrorLine, ModelCost, causeMessage, errorMessage } from "./shared";

const button = cn(xPill, xPillSm);

function IdeaRow({ idea }: { readonly idea: TrendIdea }) {
  const saveDraft = useAtomSet(saveSuggestedDraftAtom, { mode: "promise" });
  const [copied, setCopied] = useState(false);
  const [filed, setFiled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="border-b border-border py-3.5 last:border-b-0">
      <p className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="shrink-0 font-medium text-foreground/80">{idea.trend}</span>
        <span className="truncate text-muted-foreground">{idea.angle}</span>
      </p>
      <p className="mt-1.5 text-[13.5px] leading-normal whitespace-pre-wrap">{idea.text}</p>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          className={button}
          onClick={() => void navigator.clipboard.writeText(idea.text).then(() => setCopied(true))}
        >
          <TextMorph duration={250}>{copied ? "Copied" : "Copy"}</TextMorph>
        </button>
        <button
          type="button"
          className={button}
          disabled={filed}
          onClick={() =>
            void saveDraft({ text: idea.text, source: `trend:${idea.trend}` }).then(
              () => setFiled(true),
              (e: unknown) => setError(errorMessage(e)),
            )
          }
        >
          <TextMorph duration={250}>{filed ? "In Compose" : "Save as draft"}</TextMorph>
        </button>
        {error !== null ? <span className="text-2xs text-error-foreground">{error}</span> : null}
      </div>
    </li>
  );
}

/** Mounted only after Load: reading the atom is the paid call. */
function TrendList({ country }: { readonly country: string }) {
  const trends = useAtomValue(trendsAtom(country));
  return AsyncResult.match(trends, {
    onInitial: () => <Empty>Loading trends for {countryLabel(country)}</Empty>,
    onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) => <TrendTable trends={value.slice(0, 30)} />,
  });
}

/** A country's trends, and post ideas the model ties to the ones that fit the user's keywords. */
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

  const load = (
    <button type="button" className={button} onClick={() => setApplied(country)}>
      Load trends
      <Cost label={trendsQuote} />
    </button>
  );
  const ideasButton = (
    <button
      type="button"
      className={button}
      disabled={busy || applied === null}
      onClick={() => void generate()}
    >
      {busy ? "Writing" : ideas === null ? "Write 5 ideas" : "Write 5 more"}
      <ModelCost />
    </button>
  );

  return (
    <>
      <PageHeader
        title="Trends"
        detail={applied === null ? undefined : countryLabel(applied)}
        actions={
          <>
            <CountrySelect value={country} onChange={setCountry} />
            {load}
          </>
        }
      />
      <PageBody>
        {applied === null ? (
          <Empty action={load}>Trends by country, cached for 30 minutes.</Empty>
        ) : (
          <div className="grid min-h-full grid-cols-1 @min-[52rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div className="border-b border-border py-2 @min-[52rem]:border-r @min-[52rem]:border-b-0">
              <TrendList country={applied} />
            </div>
            <section className="px-6 py-4">
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="text-[12.5px] font-semibold text-foreground/80">Post ideas</h2>
                {ideasButton}
              </div>
              {error !== null ? <ErrorLine className="px-0">{error}</ErrorLine> : null}
              {ideas === null ? (
                <p className="py-6 text-sm text-muted-foreground">
                  Five posts tied to the trends that fit your keywords.
                </p>
              ) : (
                <ul>
                  {ideas.map((idea) => (
                    <IdeaRow key={`${idea.trend}:${idea.angle}`} idea={idea} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </PageBody>
    </>
  );
}
