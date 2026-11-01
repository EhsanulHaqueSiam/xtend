import { actionCostUsd, type Rule } from "@xtend/contracts";

import { cn } from "../../lib/utils";
import { usd, useRates } from "../../state/costs";
import { table } from "../ui/layout";
import { Switch } from "../ui/switch";
import { describeRule } from "./describe";

/** Budgets are whole cents; spend keeps its fractions. */
export const budget = (n: number) => `$${n.toFixed(2)}`;

/** Dry run and ask first, the two modes that change what a firing does. */
export function RuleModes({ rule }: { readonly rule: Rule }) {
  return (
    <>
      {rule.dryRun ? (
        <span className="shrink-0 font-mono text-2xs text-warning-foreground">dry run</span>
      ) : null}
      {rule.askFirst ? (
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">ask first</span>
      ) : null}
    </>
  );
}

/** One rule in the list: its switch, what it does, and its price and spend. Click opens it. */
export function RuleRow({
  rule,
  selected,
  busy,
  onSelect,
  onToggle,
}: {
  readonly rule: Rule;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onToggle: () => void;
}) {
  const rates = useRates();
  const cost = rates === null ? null : actionCostUsd(rates, rule.action);
  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      data-selected={selected}
      className={cn(table.row, "cursor-pointer outline-hidden focus-visible:bg-white/[0.04]")}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onSelect();
      }}
    >
      <td className={cn(table.td, "w-0 pr-1")}>
        <Switch
          checked={rule.enabled}
          disabled={busy}
          label={`${rule.name} on`}
          onChange={onToggle}
        />
      </td>
      <td className={cn(table.td, "w-full max-w-0 py-2")}>
        <p className={cn("truncate text-[13px]", !rule.enabled && "text-muted-foreground")}>
          {describeRule(rule).map((s, i) =>
            typeof s === "string" ? (
              // oxlint-disable-next-line react/no-array-index-key -- the parts of one sentence, in order; they never reorder.
              <span key={i} className="text-muted-foreground">
                {s}
              </span>
            ) : (
              // oxlint-disable-next-line react/no-array-index-key -- the parts of one sentence, in order; they never reorder.
              <span key={i} className={cn("font-medium", rule.enabled && "text-foreground")}>
                {s.tag}
              </span>
            ),
          )}
        </p>
        <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
          <span className="truncate">{rule.name}</span>
          <RuleModes rule={rule} />
        </div>
      </td>
      <td className={cn(table.td, table.num, "whitespace-nowrap")}>
        {cost === null ? "…" : usd(cost)}
        {rule.action.kind === "auto_delete" ? (
          <span className="text-muted-foreground"> /post</span>
        ) : null}
      </td>
      <td className={cn(table.td, table.num, "hidden whitespace-nowrap @2xl/list:table-cell")}>
        {usd(rule.spentUsdDay)}
        <span className="text-muted-foreground"> / {budget(rule.budgetUsdDay)}</span>
      </td>
      <td className={cn(table.td, table.num, "hidden whitespace-nowrap @2xl/list:table-cell")}>
        {usd(rule.spentUsdMonth)}
        <span className="text-muted-foreground"> / {budget(rule.budgetUsdMonth)}</span>
      </td>
    </tr>
  );
}
