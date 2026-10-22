import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { postCostUsd, type ReplyTarget } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck } from "lucide-react";
import { useState } from "react";

import { useRates, usd } from "../../state/costs";
import { draftReplyAtom, likeAtom, sendReplyAtom, targetsAtom } from "../../state/engage";
import { Empty, ErrorText, errorText, fmt } from "../analyze/ui";
import { inputClass } from "../compose/ThreadEditor";
import { Button } from "../ui/button";

const age = (minutes: number) =>
  minutes < 60 ? `${Math.round(minutes)} min` : `${(minutes / 60).toFixed(1)} h`;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 font-mono text-2xs text-muted-foreground">
      {label}
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

/** One target with its draft panel. State is per row so drafting several in a row works. */
function TargetRow({ target }: { readonly target: ReplyTarget }) {
  const { post } = target;
  const draft = useAtomSet(draftReplyAtom, { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom, { mode: "promiseExit" });
  const like = useAtomSet(likeAtom, { mode: "promiseExit" });
  const [drafts, setDrafts] = useState<ReadonlyArray<string>>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"draft" | "reply" | "like" | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [done, setDone] = useState<"replied" | "skipped" | null>(target.replied ? "replied" : null);
  const rates = useRates();

  const fail = (cause: Parameters<typeof errorText>[0]) =>
    setNotice({ tone: "error", text: errorText(cause) });

  const onDraft = async () => {
    setBusy("draft");
    setNotice(null);
    const exit = await draft(post);
    setBusy(null);
    if (Exit.isFailure(exit)) return fail(exit.cause);
    const list = exit.value.map((d) => d.text);
    setDrafts(list);
    setText(list[0] ?? "");
  };

  const onReply = async () => {
    setBusy("reply");
    setNotice(null);
    const exit = await send({ post, text });
    setBusy(null);
    if (Exit.isFailure(exit)) return fail(exit.cause);
    // The service records a failed X write on the row instead of throwing; surface it here.
    if (exit.value.error !== null) setNotice({ tone: "error", text: exit.value.error });
    else setDone("replied");
  };

  const onLike = async () => {
    setBusy("like");
    setNotice(null);
    const exit = await like(post.postId);
    setBusy(null);
    if (Exit.isFailure(exit)) return fail(exit.cause);
    setNotice({ tone: "ok", text: `Liked for ${usd(rates?.like ?? 0)}` });
  };

  if (done === "skipped") return null;

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-info-foreground" />
        ) : null}
        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-muted-foreground hover:underline"
        >
          @{post.author.handle}
        </a>
        <span className="font-mono text-2xs text-muted-foreground">· {age(target.ageMinutes)}</span>
        <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
          {fmt(post.author.followers)} followers · {target.keyword}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
        {post.text}
      </p>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1">
        <Metric label="velocity" value={`${fmt(target.viewsPerHour)}/h`} />
        <Metric label="replies" value={fmt(post.metrics.replies)} />
        <Metric label="likes" value={fmt(post.metrics.likes)} />
        <Metric label="reach" value={target.reach} />
        {done === "replied" ? (
          <span className="font-mono text-2xs text-success-foreground">replied</span>
        ) : null}
      </div>
      {drafts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {drafts.map((d, i) => (
              <Button
                key={d}
                variant="ghost"
                size="xs"
                data-active={d === text || undefined}
                className="data-active:bg-accent"
                onClick={() => setText(d)}
              >
                {String.fromCharCode(65 + i)}
              </Button>
            ))}
          </div>
          <textarea
            className={inputClass + " min-h-20"}
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      ) : null}
      {notice !== null ? (
        <p
          className={
            "text-xs " +
            (notice.tone === "error" ? "text-error-foreground" : "text-success-foreground")
          }
        >
          {notice.text}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="xs" disabled={busy !== null} onClick={() => void onDraft()}>
          {busy === "draft" ? "Drafting…" : drafts.length > 0 ? "Regenerate" : "Draft replies"}
        </Button>
        <Button
          size="xs"
          disabled={busy !== null || text.trim() === "" || done === "replied" || rates === null}
          onClick={() => void onReply()}
        >
          {busy === "reply"
            ? "Replying…"
            : `Reply · ${rates === null ? "…" : usd(postCostUsd(rates, text))}`}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={busy !== null || rates === null}
          onClick={() => void onLike()}
        >
          {busy === "like" ? "Liking…" : `Like · ${rates === null ? "…" : usd(rates.like)}`}
        </Button>
        <Button variant="ghost-muted" size="xs" onClick={() => setDone("skipped")}>
          Skip
        </Button>
      </div>
    </article>
  );
}

export function Targets() {
  const result = useAtomValue(targetsAtom);
  return AsyncResult.match(result, {
    onInitial: () => <Empty>Connecting to the service…</Empty>,
    onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <Empty>No targets. Add keywords in Settings or use Find keywords, then refresh.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {value.map((t) => (
            <TargetRow key={t.post.postId} target={t} />
          ))}
        </div>
      ),
  });
}
