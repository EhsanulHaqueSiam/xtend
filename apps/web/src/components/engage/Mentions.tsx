import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Mention } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { markHandledAtom, mentionsAtom } from "../../state/engage";
import { fmtWhen } from "../compose/DraftsList";
import { Empty, ErrorText, errorText, fmt } from "../analyze/ui";
import { Button } from "../ui/button";

function MentionRow({ mention, onHandled }: { mention: Mention; onHandled: () => void }) {
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
          · {fmtWhen(post.createdAt)} · {mention.source}
        </span>
        <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
          {fmt(post.metrics.likes)} likes · {fmt(post.metrics.replies)} replies
        </span>
        {mention.handled ? (
          <span className="font-mono text-2xs text-success-foreground">handled</span>
        ) : (
          <Button variant="ghost" size="xs" onClick={onHandled}>
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

export function Mentions() {
  const result = useAtomValue(mentionsAtom);
  const refresh = useAtomRefresh(mentionsAtom);
  const markHandled = useAtomSet(markHandledAtom, { mode: "promise" });
  return AsyncResult.match(result, {
    onInitial: () => <Empty>Connecting to the service…</Empty>,
    onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
    onSuccess: ({ value }) => (
      <div className="flex flex-col gap-0.5">
        {value.apiError !== null ? <ErrorText>{value.apiError}</ErrorText> : null}
        {value.mentions.length === 0 ? (
          <Empty>
            No mentions yet. Session mentions appear as you browse x.com in the desktop app.
          </Empty>
        ) : (
          value.mentions.map((m) => (
            <MentionRow
              key={m.post.postId}
              mention={m}
              onHandled={async () => {
                await markHandled(m.post.postId);
                refresh();
              }}
            />
          ))
        )}
      </div>
    ),
  });
}
