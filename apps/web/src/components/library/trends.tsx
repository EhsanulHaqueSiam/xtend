import type { XTrend } from "@xtend/contracts";

import { cn } from "../../lib/utils";
import { table } from "../ui/layout";
import { Select } from "../ui/select";
import { XLink } from "../ui/x-link";
import { fmt } from "./shared";

/** The scraper's country names for X trends. */
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
