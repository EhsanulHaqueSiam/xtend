import { useAtomSet } from "@effect/atom-react";
import type { DmEvent } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useEffect, useState } from "react";

import { dmsAtom } from "../../state/engage";
import { fmtWhen } from "../compose/DraftsList";
import { Empty, ErrorText, errorText, usd } from "../analyze/ui";
import { Button } from "../ui/button";

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span>One page of your direct message events, read through X's API.</span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          disabled={busy || quote === null}
          onClick={() => void load()}
        >
          {busy ? "Loading…" : `Load DM history (${quote === null ? "…" : usd(quote)})`}
        </Button>
      </div>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {events === null ? null : events.length === 0 ? (
        <Empty>No DM events came back.</Empty>
      ) : (
        <table className="w-full">
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border align-top">
                <td className="py-1.5 pr-3 font-mono text-2xs text-muted-foreground whitespace-nowrap">
                  {e.createdAt === null ? "" : fmtWhen(e.createdAt)}
                </td>
                <td className="py-1.5 pr-3 font-mono text-2xs text-muted-foreground whitespace-nowrap">
                  {e.eventType}
                  {e.senderId === null ? "" : ` · ${e.senderId}`}
                </td>
                <td className="py-1.5 text-xs text-foreground/90">{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
