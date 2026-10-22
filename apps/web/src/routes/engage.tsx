import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { ErrorText, errorText, Tabs, usd } from "../components/analyze/ui";
import { Inbox } from "../components/engage/Inbox";
import { Mentions } from "../components/engage/Mentions";
import { Targets } from "../components/engage/Targets";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { addKeywordsAtom, findKeywordsAtom, mentionsAtom, targetsAtom } from "../state/engage";

const TABS = ["Targets", "Mentions", "Inbox", "DM follow-ups"] as const;
/** Up to 5 keyword searches, one page each. Mirrors Engage.targets in the service. */
const TARGETS_COST = 5 * 0.00075;
/** One own-timeline page plus a model call. */
const FIND_COST = 0.00075;
/** X's mentions endpoint; session mentions are free. */
const MENTIONS_COST = 0.005;

type Suggestions = { keywords: ReadonlyArray<string>; handles: ReadonlyArray<string> };

function EngageScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Targets");
  const refreshTargets = useAtomRefresh(targetsAtom);
  const refreshMentions = useAtomRefresh(mentionsAtom);
  const find = useAtomSet(findKeywordsAtom, { mode: "promiseExit" });
  const findState = useAtomValue(findKeywordsAtom);
  const addKeywords = useAtomSet(addKeywordsAtom, { mode: "promise" });
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
                {findState.waiting ? "Finding…" : `Find keywords (${usd(FIND_COST)})`}
              </Button>
              <Button size="sm" variant="outline" onClick={refreshTargets}>
                Refresh targets ({usd(TARGETS_COST)})
              </Button>
            </>
          ) : tab === "Mentions" ? (
            <Button size="sm" variant="outline" onClick={refreshMentions}>
              Refresh mentions ({usd(MENTIONS_COST)})
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
                  onClick={async () => {
                    await addKeywords(found.keywords);
                    setFound(null);
                    refreshTargets();
                  }}
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
          <Inbox view="sent" />
        ) : (
          <Inbox view="followUps" />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/engage")({ component: EngageScreen });
