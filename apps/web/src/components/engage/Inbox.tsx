import { useAtomValue } from "@effect/atom-react";
import type { SentReply } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { inboxAtom } from "../../state/engage";
import { fmtWhen } from "../compose/DraftsList";
import { Empty, ErrorText, errorText } from "../analyze/ui";

function Row({ reply }: { reply: SentReply }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5 pr-3 font-mono text-2xs text-muted-foreground whitespace-nowrap">
        {fmtWhen(reply.at)}
      </td>
      <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
        <a href={reply.targetUrl} target="_blank" rel="noreferrer" className="hover:underline">
          @{reply.targetHandle}
        </a>
      </td>
      <td className="py-1.5 pr-3 text-xs text-foreground/90">{reply.text}</td>
      <td className="py-1.5 font-mono text-2xs whitespace-nowrap">
        {reply.error !== null ? (
          <span className="text-error-foreground" title={reply.error}>
            failed
          </span>
        ) : (
          <span className="text-success-foreground">sent</span>
        )}
      </td>
    </tr>
  );
}

function Table({ rows, empty }: { rows: ReadonlyArray<SentReply>; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <table className="w-full">
      <tbody>
        {rows.map((r) => (
          <Row key={r.id} reply={r} />
        ))}
      </tbody>
    </table>
  );
}

/** Replies sent from this app, with the X error kept on failed rows. */
export function Inbox({ view }: { view: "sent" | "followUps" }) {
  const result = useAtomValue(inboxAtom);
  return AsyncResult.match(result, {
    onInitial: () => <Empty>Connecting to the service…</Empty>,
    onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
    onSuccess: ({ value }) =>
      view === "sent" ? (
        <Table rows={value.sent} empty="No replies sent yet." />
      ) : (
        <>
          <p className="pb-1 text-2xs text-muted-foreground">
            Replies older than two days with nothing from you since. Worth a second touch.
          </p>
          <Table rows={value.followUps} empty="Nothing to follow up on." />
        </>
      ),
  });
}
