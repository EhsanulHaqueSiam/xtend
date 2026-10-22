import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Pick } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import {
  fetchPicksAtom,
  pickDraftAtom,
  pickWhyAtom,
  saveSuggestedDraftAtom,
  picksAtom,
} from "../../state/library";
import { Button } from "../ui/button";
import { SaveButton } from "./SaveButton";
import { InspireButton } from "./SearchTab";
import { Empty, ErrorLine, PostRow, errorMessage } from "./shared";

/** Treg's price for one search page, one per keyword per day. */
const SEARCH_COST_USD = 0.00075;

function PickRow({ pick }: { readonly pick: Pick }) {
  const why = useAtomSet(pickWhyAtom, { mode: "promise" });
  const draft = useAtomSet(pickDraftAtom, { mode: "promise" });
  const saveDraft = useAtomSet(saveSuggestedDraftAtom, { mode: "promise" });
  const [whyText, setWhyText] = useState(pick.whyItWorks);
  const [blocks, setBlocks] = useState<ReadonlyArray<string> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (work: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await work();
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PostRow
      post={pick.post}
      badge={
        <span className="rounded-sm border border-border px-1 font-mono text-2xs text-muted-foreground">
          {pick.keyword}
        </span>
      }
      actions={
        <>
          <SaveButton post={pick.post} />
          <InspireButton post={pick.post} />
          {whyText === null ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void call(async () => setWhyText(await why(pick.post.postId)))}
            >
              <Sparkles /> Why it works
            </Button>
          ) : null}
          {blocks === null ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void call(async () => setBlocks(await draft(pick.post.postId)))}
            >
              <Wand2 /> Ready to post
            </Button>
          ) : null}
          {status !== null ? (
            <span className="text-2xs text-error-foreground">{status}</span>
          ) : null}
        </>
      }
    >
      {whyText !== null ? (
        <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-xs text-muted-foreground">
          {whyText}
        </p>
      ) : null}
      {blocks !== null ? (
        <div className="mt-2 flex flex-col gap-1.5 border-l-2 border-success pl-2">
          {blocks.map((b, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm">
              {b}
            </p>
          ))}
          <div>
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                void call(async () => {
                  const { id } = await saveDraft({
                    text: blocks.join("\n\n"),
                    source: `pick:${pick.post.postId}`,
                  });
                  setStatus(`Stored as suggested draft #${id} (Compose has no drafts rpc yet).`);
                })
              }
            >
              Send to Compose
            </Button>
          </div>
        </div>
      ) : null}
    </PostRow>
  );
}

export function PicksTab() {
  const state = useAtomValue(picksAtom);
  const refresh = useAtomRefresh(picksAtom);
  const fetch = useAtomSet(fetchPicksAtom, { mode: "promise" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch();
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return AsyncResult.match(state, {
    onInitial: () => <Empty>Loading…</Empty>,
    onFailure: (f) => <ErrorLine>{String(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) => (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-2xs text-muted-foreground">
          <span>
            {value.day}: top posts of the last 7 days for{" "}
            {value.keywords.length === 0
              ? "no keywords (set them in Settings)"
              : value.keywords.join(", ")}
          </span>
          {value.pending.length > 0 ? (
            <Button
              size="xs"
              className="ml-auto"
              disabled={busy || value.keywords.length === 0}
              onClick={() => void run()}
            >
              Fetch {value.pending.length} keyword{value.pending.length === 1 ? "" : "s"} for $
              {(value.pending.length * SEARCH_COST_USD).toFixed(5)}
            </Button>
          ) : (
            <span className="ml-auto">fetched today</span>
          )}
        </div>
        {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {value.picks.length === 0 ? (
            <Empty>No picks yet today.</Empty>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 py-2">
              {value.picks.map((pick) => (
                <PickRow key={pick.post.postId} pick={pick} />
              ))}
            </div>
          )}
        </div>
      </div>
    ),
  });
}
