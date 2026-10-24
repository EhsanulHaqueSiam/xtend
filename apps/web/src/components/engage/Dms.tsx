import { useAtomSet } from "@effect/atom-react";
import type { DmEvent } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useEffect, useState } from "react";
import { TextMorph } from "torph/react";

import { fmtWhen } from "../../lib/time";
import { dmsAtom } from "../../state/engage";
import { errorText } from "../analyze/ui";
import { PageHeader } from "../PageHeader";
import { Cost, Empty, PageBody } from "../ui/layout";
import { ErrorLine, pill } from "./triage";

/** DM history through the team's own X tool. The X connection is currently broken upstream, so the error shows as is. */
export function Dms() {
  const call = useAtomSet(dmsAtom, { mode: "promiseExit" });
  const [quote, setQuote] = useState<number | null>(null);
  const [events, setEvents] = useState<ReadonlyArray<DmEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call(false).then((exit) => {
      if (Exit.isSuccess(exit)) setQuote(exit.value.quoteUsd);
    });
  }, [call]);

  const load = async () => {
    setBusy(true);
    setError(null);
    const exit = await call(true);
    setBusy(false);
    if (Exit.isFailure(exit)) return setError(errorText(exit.cause));
    setEvents(exit.value.error === null ? exit.value.events : null);
    setError(exit.value.error);
  };

  const button = (label: string) => (
    <button
      type="button"
      className={pill}
      disabled={busy || quote === null}
      onClick={() => void load()}
    >
      <TextMorph duration={250}>{busy ? "Loading…" : label}</TextMorph>
      {quote === null ? <Cost label="…" /> : <Cost usd={quote} />}
    </button>
  );

  return (
    <>
      <PageHeader
        title="DMs"
        detail={events === null ? undefined : `${events.length} events`}
        // Before the first load the button sits where the messages will be.
        actions={events === null ? undefined : button("Load again")}
      />
      <PageBody>
        {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
        {events === null ? (
          <Empty action={button("Load DM history")}>
            One page of your direct message events, read through X's API.
          </Empty>
        ) : events.length === 0 ? (
          <Empty>No DM events came back.</Empty>
        ) : (
          events.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-border px-6 py-2.5 text-[13px]"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-2xs text-muted-foreground">
                  {e.eventType}
                  {e.senderId === null ? "" : ` · ${e.senderId}`}
                </p>
                <p className="mt-0.5 break-words whitespace-pre-wrap">{e.text}</p>
              </div>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {e.createdAt === null ? "" : fmtWhen(e.createdAt)}
              </span>
            </div>
          ))
        )}
      </PageBody>
    </>
  );
}
