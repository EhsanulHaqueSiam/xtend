import { useAtomValue } from "@effect/atom-react";
import type { XTrend } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { trendingAtom } from "../../state/scores";
import { PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody, table } from "../ui/layout";
import { xPill, xPillSm } from "../x";
import { ErrorLine, causeMessage, fmt } from "../library/shared";
import { XLink } from "../ui/x-link";
import { Select } from "../ui/select";

/** The scraper's country names; Library's trends section uses the same list. */
export const TREND_COUNTRIES = [
  "UnitedStates",
  "UnitedKingdom",
  "India",
  "Bangladesh",
  "Germany",
  "Japan",
  "Brazil",
] as const;

/** "UnitedStates" reads as "United States". */
export const countryLabel = (country: string) => country.replace(/([a-z])([A-Z])/g, "$1 $2");

export function CountrySelect({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (country: string) => void;
}) {
  return (
    <Select
      compact
      label="Country"
      value={value}
      onChange={onChange}
      options={TREND_COUNTRIES.map((c) => ({ value: c, label: countryLabel(c) }))}
    />
  );
}

/** Ranked trends; each opens X's search for it. */
export function TrendTable({ trends }: { readonly trends: ReadonlyArray<XTrend> }) {
  return (
    <table className={table.root}>
      <thead>
        <tr>
          <th className={cn(table.th, "w-12 text-right")}>#</th>
          <th className={table.th}>Trend</th>
          <th className={cn(table.th, "@max-[36rem]:hidden")}>Context</th>
          <th className={cn(table.th, "text-right")}>Posts</th>
        </tr>
      </thead>
      <tbody>
        {trends.map((t, i) => (
          <tr key={t.name} className={table.row}>
            <td className={cn(table.td, table.num, "text-muted-foreground")}>{i + 1}</td>
            <td className={cn(table.td, "max-w-0 truncate")}>
              <XLink
                href={`https://x.com/search?q=${encodeURIComponent(t.name)}`}
                className="hover:underline"
              >
                {t.name}
              </XLink>
            </td>
            <td
              className={cn(table.td, "max-w-0 truncate text-muted-foreground @max-[36rem]:hidden")}
            >
              {t.context ?? ""}
            </td>
            <td className={cn(table.td, table.num)}>
              {t.postCount === null ? "–" : fmt(t.postCount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Mounted only after Load: reading the atom is the paid call. */
function Trends({ country }: { readonly country: string }) {
  const trends = useAtomValue(trendingAtom(country));
  return AsyncResult.match(trends, {
    onInitial: () => <Empty>Loading trends for {countryLabel(country)}</Empty>,
    onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <Empty>X returned no trends for {countryLabel(country)}.</Empty>
      ) : (
        <TrendTable trends={value} />
      ),
  });
}

/** X trending topics by country; the atom only mounts (and pays) after the Load click. */
export function Trending() {
  const [country, setCountry] = useState<string>(TREND_COUNTRIES[0]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const quote = useQuoteLabel({ kind: "trending", country });
  const load = (
    <button type="button" className={cn(xPill, xPillSm)} onClick={() => setLoaded(country)}>
      Load
      <Cost label={quote} />
    </button>
  );
  return (
    <>
      <PageHeader
        title="Trending"
        detail={loaded === null ? undefined : countryLabel(loaded)}
        actions={
          <>
            <CountrySelect value={country} onChange={setCountry} />
            {load}
          </>
        }
      />
      <PageBody>
        {loaded === null ? (
          <Empty action={load}>What X is talking about by country, cached for 30 minutes.</Empty>
        ) : (
          <Trends country={loaded} />
        )}
      </PageBody>
    </>
  );
}
