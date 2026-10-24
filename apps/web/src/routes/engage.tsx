import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { ErrorText, errorText, Tabs } from "../components/analyze/ui";
import { Dms } from "../components/engage/Dms";
import { Inbox } from "../components/engage/Inbox";
import { Mentions } from "../components/engage/Mentions";
import { Targets } from "../components/engage/Targets";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { quoteAtom, useQuoteLabel } from "../state/costs";
import {
  addKeywordsAtom,
  findKeywordsAtom,
  mentionsAtom,
  refreshMentionsAtom,
  targetsAtom,
} from "../state/engage";

const TABS = ["Targets", "Mentions", "Inbox", "Sent", "Follow-ups", "DMs"] as const;

type Suggestions = { keywords: ReadonlyArray<string>; handles: ReadonlyArray<string> };

export function EngageScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Targets");
  const loadTargets = useAtomSet(targetsAtom);
  const targetsState = useAtomValue(targetsAtom);
  const refreshTargetsQuote = useAtomRefresh(quoteAtom([{ kind: "engageTargets" }]));
  const refreshMentions = useAtomRefresh(mentionsAtom);
  const fetchMentions = useAtomSet(refreshMentionsAtom, { mode: "promiseExit" });
  const fetchState = useAtomValue(refreshMentionsAtom);
  const find = useAtomSet(findKeywordsAtom, { mode: "promiseExit" });
  const findState = useAtomValue(findKeywordsAtom);
  const targetsQuote = useQuoteLabel({ kind: "engageTargets" });
  const findQuote = useQuoteLabel({ kind: "findKeywords" });
  const mentionsQuote = useQuoteLabel({ kind: "mentions" });
  const addKeywords = useAtomSet(addKeywordsAtom, { mode: "promise" });
  const adding = useAtomValue(addKeywordsAtom).waiting;
  const [found, setFound] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mentions = useAtomValue(mentionsAtom);
  const unhandled = AsyncResult.getOrElse(
    AsyncResult.map(mentions, (v) => v.mentions.filter((m) => !m.handled).length),
    () => null,
  );

  const runFind = async () => {
    setError(null);
    const exit = await find();
    if (Exit.isFailure(exit)) setError(errorText(exit.cause));
    else setFound(exit.value);
  };
  // New keywords are searches the cache has not seen: requote, and let the priced click run them.
  const runAddKeywords = async (keywords: ReadonlyArray<string>) => {
    setError(null);
    try {
      await addKeywords(keywords);
      setFound(null);
      refreshTargetsQuote();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const runFetchMentions = async () => {
    setError(null);
    const exit = await fetchMentions();
    if (Exit.isFailure(exit)) return setError(errorText(exit.cause));
    // X refusing the read comes back in the result; the free list refetched below never carries it.
    setError(exit.value.apiError);
    refreshMentions();
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Engage"
        detail={unhandled === null ? undefined : `${unhandled} unhandled mentions`}
        actions={
          tab === "Targets" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={findState.waiting}
                onClick={() => void runFind()}
              >
                {findState.waiting ? "Finding…" : `Find keywords (${findQuote} + model)`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={targetsState.waiting}
                onClick={() => loadTargets()}
              >
                {targetsState.waiting ? "Searching…" : `Refresh targets (${targetsQuote})`}
              </Button>
            </>
          ) : tab === "Mentions" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={fetchState.waiting}
              onClick={() => void runFetchMentions()}
            >
              {fetchState.waiting ? "Fetching…" : `Fetch new mentions (${mentionsQuote})`}
            </Button>
          ) : undefined
        }
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 overflow-y-auto px-4 py-3">
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
        {found !== null && tab === "Targets" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">Suggested keywords</span>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  disabled={adding}
                  onClick={() => void runAddKeywords(found.keywords)}
                >
                  Add all to keywords
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setFound(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
            <p className="font-mono text-2xs">{found.keywords.join(" · ")}</p>
            {found.handles.length > 0 ? (
              <p className="font-mono text-2xs text-muted-foreground">
                handles: {found.handles.map((h) => `@${h}`).join(" ")}
              </p>
            ) : null}
          </div>
        ) : null}
        {tab === "Targets" ? (
          <Targets />
        ) : tab === "Mentions" ? (
          <Mentions />
        ) : tab === "Inbox" ? (
          <Inbox view="incoming" />
        ) : tab === "Sent" ? (
          <Inbox view="sent" />
        ) : tab === "Follow-ups" ? (
          <Inbox view="followUps" />
        ) : (
          <Dms />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/engage")({ component: EngageScreen });
