import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Pick, StaffPick } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import {
  fetchPicksAtom,
  fetchStaffPicksAtom,
  generateReadyAtom,
  pickDraftAtom,
  pickWhyAtom,
  saveSuggestedDraftAtom,
  picksAtom,
  staffPicksAtom,
} from "../../state/library";
import { Button } from "../ui/button";
import { SaveButton } from "./SaveButton";
import { InspireButton } from "./SearchTab";
import { useQuoteLabel, useRates, usd } from "../../state/costs";
import { TREND_COUNTRIES } from "../scores/Trending";
import { Empty, ErrorLine, PostRow, errorMessage } from "./shared";

/** The curated evergreen posts; text arrives with one `from:handle` search per author. */
function StaffPicks() {
  const result = useAtomValue(staffPicksAtom);
  const refresh = useAtomRefresh(staffPicksAtom);
  const fetch = useAtomSet(fetchStaffPicksAtom, { mode: "promise" });
  const rates = useRates();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picks = AsyncResult.getOrElse(result, (): ReadonlyArray<StaffPick> => []);
  const missing = new Set(picks.filter((p) => p.post === null).map((p) => p.handle)).size;
  return (
    <div className="border-t border-border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-2xs text-muted-foreground">
        <span>Staff picks: {picks.length} evergreen posts on building, marketing and AI</span>
        {missing > 0 ? (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            disabled={busy || rates === null}
            onClick={async () => {
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
            }}
          >
            {busy
              ? "Fetching…"
              : `Fetch text for ${missing} authors (${rates === null ? "…" : usd(rates.searchPage * missing)})`}
          </Button>
        ) : null}
      </div>
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 pb-2">
        {picks.map((p) =>
          p.post === null ? (
            <div
              key={p.postId}
              className="flex items-center gap-2 px-3 py-1.5 font-mono text-2xs text-muted-foreground"
            >
              <span className="rounded-sm border border-border px-1">{p.topic}</span>
              <a
                href={`https://x.com/${p.handle}/status/${p.postId}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground"
              >
                @{p.handle}/{p.postId}
              </a>
              <span>text not fetched</span>
            </div>
          ) : (
            <PostRow
              key={p.postId}
              post={p.post}
              badge={
                <span className="rounded-sm border border-border px-1 font-mono text-2xs text-muted-foreground">
                  {p.topic}
                </span>
              }
              actions={
                <>
                  <SaveButton post={p.post} />
                  <InspireButton post={p.post} />
                </>
              }
            />
          ),
        )}
      </div>
    </div>
  );
}

function PickRow({ pick }: { readonly pick: Pick }) {
  const why = useAtomSet(pickWhyAtom(pick.post.postId), { mode: "promise" });
  const draft = useAtomSet(pickDraftAtom(pick.post.postId), { mode: "promise" });
  const saveDraft = useAtomSet(saveSuggestedDraftAtom, { mode: "promise" });
  const [whyText, setWhyText] = useState(pick.whyItWorks);
  const [blocks, setBlocks] = useState<ReadonlyArray<string> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One suggested draft per answer; a second click would file a duplicate.
  const [sent, setSent] = useState(false);

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
              onClick={() => void call(async () => setWhyText(await why()))}
            >
              <Sparkles /> Why it works (model)
            </Button>
          ) : null}
          {blocks === null ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void call(async () => setBlocks(await draft()))}
            >
              <Wand2 /> Ready to post (model)
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
            // eslint-disable-next-line react/no-array-index-key -- model output; two posts can share a text.
            <p key={i} className="whitespace-pre-wrap text-sm">
              {b}
            </p>
          ))}
          <div>
            <Button
              variant="outline"
              size="xs"
              disabled={busy || sent}
              onClick={() =>
                void call(async () => {
                  await saveDraft({
                    text: blocks.join("\n\n"),
                    source: `pick:${pick.post.postId}`,
                  });
                  setSent(true);
                })
              }
            >
              {sent ? "Sent to Compose" : "Send to Compose"}
            </Button>
          </div>
        </div>
      ) : null}
    </PostRow>
  );
}

export function PicksTab() {
  const picksQuote = useQuoteLabel({ kind: "picksFetch" });
  const state = useAtomValue(picksAtom);
  const refresh = useAtomRefresh(picksAtom);
  const fetch = useAtomSet(fetchPicksAtom, { mode: "promise" });
  const generate = useAtomSet(generateReadyAtom, { mode: "promise" });
  const trendingQuote = useQuoteLabel({ kind: "trending", country: TREND_COUNTRIES[0] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"picks" | "ready" | null>(null);

  const call = async (which: "picks" | "ready", work: () => Promise<string | null>) => {
    setBusy(which);
    setError(null);
    try {
      setError(await work());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const run = () =>
    call("picks", async () => {
      await fetch();
      refresh();
      return null;
    });
  const runReady = () =>
    call("ready", async () => {
      const posts = await generate(TREND_COUNTRIES[0]);
      return `Filed ${posts.length} suggested drafts in Compose: ${posts.map((p) => `${p.basis} (voice ${p.voiceMatch})`).join(", ")}.`;
    });

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
          <span className="ml-auto flex items-center gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void runReady()}
            >
              <Wand2 />{" "}
              {busy === "ready" ? "Writing…" : `Ready-to-post x3 (${trendingQuote} + model)`}
            </Button>
            {value.pending.length > 0 ? (
              <Button
                size="xs"
                disabled={busy !== null || value.keywords.length === 0}
                onClick={() => void run()}
              >
                Fetch {value.pending.length} keyword{value.pending.length === 1 ? "" : "s"} for{" "}
                {picksQuote}
              </Button>
            ) : (
              <span>fetched today · runs daily at 08:00, ready-to-post at 08:30</span>
            )}
          </span>
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
          <StaffPicks />
        </div>
      </div>
    ),
  });
}
