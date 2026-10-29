import { CostAction, Costs_METHODS, type CostQuote } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useAtomValue } from "@effect/atom-react";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/** The service's rate card; the only place a client gets a price. */
const ratesAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return (yield* client[Costs_METHODS.quote]({ actions: [] })).rates;
  }),
);

// Keyed by the JSON of the actions so equal requests share one quote.
const ActionsJson = Schema.fromJsonString(Schema.Array(CostAction));
const decodeActions = Schema.decodeSync(ActionsJson);
const encodeActions = Schema.encodeSync(ActionsJson);
// "cached, free" goes stale both ways: a paid call fills the cache it reads (spend_changed),
// and the service's cache expires on its own (the minute refresh).
const quoteFamily = Atom.family((key: string) =>
  clientRuntime
    .atom((get) =>
      Effect.gen(function* () {
        get(eventsOfTypeAtom("spend_changed"));
        const client = yield* XtendClient;
        return (yield* client[Costs_METHODS.quote]({ actions: decodeActions(key) })).quotes;
      }),
    )
    .pipe(Atom.withRefresh("1 minute")),
);
/** Refresh it when something the quote cannot see changed, such as the keywords a search uses. */
export const quoteAtom = (actions: ReadonlyArray<CostAction>) =>
  quoteFamily(encodeActions(actions));

export const usd = (n: number) => `$${n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;

/** The service's quote for one action; null until it arrives. */
export function useQuote(action: CostAction): CostQuote | null {
  return AsyncResult.getOrElse(useAtomValue(quoteAtom([action])), () => null)?.[0] ?? null;
}

/** "($0.00075)" or "(cached, free)" for a button label; "…" until the quote arrives. */
export function useQuoteLabel(action: CostAction): string {
  const q = useQuote(action);
  return q === null ? "…" : q.cached ? "cached, free" : q.usd === 0 ? "free" : usd(q.usd);
}

/** Several quotes as one label: the free parts drop out, so "$0.00075 + free" reads "$0.00075". */
export const costLabels = (...labels: ReadonlyArray<string>) => {
  const paid = labels.filter((l) => l !== "free" && l !== "cached, free");
  return paid.length === 0 ? "free" : paid.join(" + ");
};

export function useRates() {
  return AsyncResult.getOrElse(useAtomValue(ratesAtom), () => null);
}
