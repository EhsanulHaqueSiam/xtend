import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Mention, SentReply } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { inboxAtom, markHandledAtom } from "../../state/engage";
import { fmtWhen } from "../compose/DraftsList";
import { Empty, ErrorText, errorText } from "../analyze/ui";
import { Button } from "../ui/button";

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
      <td
        className="py-1.5 pr-3 font-mono text-2xs text-muted-foreground whitespace-nowrap"
        title="New followers within 24 h who are this author or replied to you"
      >
        {reply.attributedFollowers > 0 ? `+${reply.attributedFollowers} followers` : ""}
      </td>
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

function IncomingRow({ mention, onHandled }: { mention: Mention; onHandled: () => void }) {
  const { post } = mention;
  return (
    <article className="flex flex-col gap-1 rounded-lg px-3 py-2 hover:bg-accent/60">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author.name}</span>
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-muted-foreground hover:underline"
        >
          @{post.author.handle}
        </a>
        <span className="font-mono text-2xs text-muted-foreground">
          · {fmtWhen(post.createdAt)} · {post.isReply ? "reply" : "quote"}
        </span>
        {mention.handled ? (
          <span className="ml-auto font-mono text-2xs text-success-foreground">handled</span>
        ) : (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={onHandled}>
            Mark handled
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
        {post.text}
      </p>
    </article>
  );
}

/** Replies and quotes to the user's posts the session saw, replies sent from here, and follow-ups. */
export function Inbox({ view }: { view: "incoming" | "sent" | "followUps" }) {
  const result = useAtomValue(inboxAtom);
  const refresh = useAtomRefresh(inboxAtom);
  const markHandled = useAtomSet(markHandledAtom, { mode: "promise" });
  return AsyncResult.match(result, {
    onInitial: () => <Empty>Connecting to the service…</Empty>,
    onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
    onSuccess: ({ value }) =>
      view === "incoming" ? (
        value.incoming.length === 0 ? (
          <Empty>
            No incoming replies or quotes yet. They appear as you browse x.com in the desktop app.
          </Empty>
        ) : (
          <div className="flex flex-col gap-0.5">
            {value.incoming.map((m) => (
              <IncomingRow
                key={m.post.postId}
                mention={m}
                onHandled={async () => {
                  await markHandled(m.post.postId);
                  refresh();
                }}
              />
            ))}
          </div>
        )
      ) : view === "sent" ? (
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
