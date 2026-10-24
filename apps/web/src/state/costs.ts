import { CostAction, Costs_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useAtomValue } from "@effect/atom-react";

import { clientRuntime, XtendClient } from "../rpc/client";

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
const quoteFamily = Atom.family((key: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return (yield* client[Costs_METHODS.quote]({ actions: decodeActions(key) })).quotes;
    }),
  ),
);
const quoteAtom = (actions: ReadonlyArray<CostAction>) => quoteFamily(encodeActions(actions));

export const usd = (n: number) => `$${n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;

/** The quote for one action, `{ usd, cached }`; null until it arrives. */
export function useQuote(
  action: CostAction,
): { readonly usd: number; readonly cached: boolean } | null {
  const quotes = useAtomValue(quoteAtom([action]));
  return AsyncResult.getOrElse(quotes, () => null)?.[0] ?? null;
}

/** "($0.00075)" or "(cached, free)" for a button label; "…" until the quote arrives. */
export function useQuoteLabel(action: CostAction): string {
  const quotes = useAtomValue(quoteAtom([action]));
  const q = AsyncResult.getOrElse(quotes, () => null)?.[0];
  return q === undefined ? "…" : q.cached ? "cached, free" : usd(q.usd);
}

export function useRates() {
  return AsyncResult.getOrElse(useAtomValue(ratesAtom), () => null);
}
