import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { useQuoteLabel } from "../../state/costs";
import { trendingAtom } from "../../state/scores";
import { Empty, ErrorText, errorText, fmt, inputClass, Section } from "../analyze/ui";
import { Button } from "../ui/button";

/** The scraper's country names; Library's trends tab uses the same list. */
export const TREND_COUNTRIES = [
  "UnitedStates",
  "UnitedKingdom",
  "India",
  "Bangladesh",
  "Germany",
  "Japan",
  "Brazil",
] as const;

function Trends({ country }: { readonly country: string }) {
  const trends = useAtomValue(trendingAtom(country));
  return AsyncResult.match(trends, {
    onInitial: () => <Empty>Loading…</Empty>,
    onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <Empty>No trends returned for {country}.</Empty>
      ) : (
        <ol className="flex flex-col gap-0.5 text-xs">
          {value.map((t, i) => (
            <li key={t.name} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-2xs text-muted-foreground">
                {i + 1}
              </span>
              <a
                href={`https://x.com/search?q=${encodeURIComponent(t.name)}`}
                target="_blank"
                rel="noreferrer"
                className="truncate hover:underline"
              >
                {t.name}
              </a>
              {t.context === null ? null : (
                <span className="truncate text-2xs text-muted-foreground">{t.context}</span>
              )}
              <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                {t.postCount === null ? "" : `${fmt(t.postCount)} posts`}
              </span>
            </li>
          ))}
        </ol>
      ),
  });
}

/** X trending topics by country; the atom only mounts (and pays) after the Load click. */
export function Trending() {
  const [country, setCountry] = useState<string>(TREND_COUNTRIES[0]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const quote = useQuoteLabel({ kind: "trending", country });
  return (
    <Section
      title="Trending on X"
      actions={
        <div className="flex gap-1">
          <select
            className={inputClass + " w-auto py-0.5"}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {TREND_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Button size="xs" variant="outline" onClick={() => setLoaded(country)}>
            Load ({quote})
          </Button>
        </div>
      }
    >
      {loaded === null ? (
        <Empty>Pick a country and load. Cached for 30 minutes on the service.</Empty>
      ) : (
        <Trends country={loaded} />
      )}
    </Section>
  );
}
