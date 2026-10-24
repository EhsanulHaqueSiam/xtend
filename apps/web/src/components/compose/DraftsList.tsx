import { useAtomValue } from "@effect/atom-react";
import {
  type Draft,
  type DraftBlock,
  type DraftMedia,
  postCostUsd,
  type RateCard,
} from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { fmtWhen } from "../../lib/time";
import { composeQuoteAtom } from "../../state/compose";
import { useRates } from "../../state/costs";

export { fmtWhen };

export const draftTitle = (d: Draft) =>
  (d.kind === "article" ? d.title : (d.blocks[0]?.text ?? "")).split("\n")[0]?.trim() || "Untitled";

export const statusTone: Record<Draft["status"], string> = {
  draft: "text-muted-foreground",
  queued: "text-info-foreground",
  posting: "text-info-foreground",
  posted: "text-success-foreground",
  failed: "text-error-foreground",
  suggested: "text-warning-foreground",
};

/**
 * What each post of a thread costs at treg's rates. A quoted link rides on the first post at
 * the link price; a post with media goes through the x.com session, which treg does not bill.
 */
export const postCosts = (
  rates: RateCard,
  blocks: ReadonlyArray<DraftBlock>,
  media: ReadonlyArray<Pick<DraftMedia, "blockIndex">>,
  quoteUrl: string | null,
) =>
  blocks.map((b, i) =>
    media.some((m) => m.blockIndex === i)
      ? 0
      : postCostUsd(rates, i === 0 && quoteUrl !== null ? `${b.text} ${quoteUrl}` : b.text),
  );

export const sumUsd = (costs: ReadonlyArray<number>) => costs.reduce((a, b) => a + b, 0);

/** A saved draft's price to post, or null until the rate card arrives. Articles are two requests. */
export function useDraftCost() {
  const rates = useRates();
  const quote = AsyncResult.getOrElse(useAtomValue(composeQuoteAtom), () => null);
  return (d: Draft): number | null =>
    d.kind === "article"
      ? quote === null
        ? null
        : quote.articleUsd * 2
      : rates === null
        ? null
        : sumUsd(postCosts(rates, d.blocks, d.media, d.quoteUrl));
}
