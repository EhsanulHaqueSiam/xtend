import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { postCostUsd, type ReplyTarget } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { useQuote, useRates, usd } from "../../state/costs";
import {
  draftReplyAtom,
  likeAtom,
  nicheAtom,
  rebuildNicheAtom,
  sendReplyAtom,
  targetsAtom,
} from "../../state/engage";
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
  const draft = useAtomSet(draftReplyAtom(post.postId), { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom(post.postId), { mode: "promiseExit" });
  const like = useAtomSet(likeAtom(post.postId), { mode: "promiseExit" });
  const [drafts, setDrafts] = useState<ReadonlyArray<string>>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"draft" | "reply" | "like" | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [done, setDone] = useState<"replied" | "skipped" | null>(target.replied ? "replied" : null);
  // A second like is another paid call for nothing.
  const [liked, setLiked] = useState(false);
  const rates = useRates();
  // The service's price: the first like of the day also pays for the account lookup.
  const likeQuote = useQuote({ kind: "like" });

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
    // Read before the call: the like itself fills the lookup cache and requotes.
    const price = likeQuote?.usd ?? 0;
    setBusy("like");
    setNotice(null);
    const exit = await like();
    setBusy(null);
    if (Exit.isFailure(exit)) return fail(exit.cause);
    setLiked(true);
    setNotice({ tone: "ok", text: `Liked for ${usd(price)}` });
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
          {fmt(post.author.followers)} followers
          {target.authorScore === null ? "" : ` · score ${Math.round(target.authorScore)}`}
          {target.repliesToAuthor > 0 ? ` · you replied ${target.repliesToAuthor}x` : ""}
          {" · "}
          {target.keyword}
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
          disabled={busy !== null || likeQuote === null || liked}
          onClick={() => void onLike()}
        >
          {busy === "like"
            ? "Liking…"
            : liked
              ? "Liked"
              : `Like · ${likeQuote === null ? "…" : usd(likeQuote.usd)}`}
        </Button>
        <Button variant="ghost-muted" size="xs" onClick={() => setDone("skipped")}>
          Skip
        </Button>
      </div>
    </article>
  );
}

/** Who the user replies to and about what; rebuilt nightly at 03:00 or on demand. */
function NicheLine() {
  const result = useAtomValue(nicheAtom);
  const refresh = useAtomRefresh(nicheAtom);
  const rebuild = useAtomSet(rebuildNicheAtom, { mode: "promiseExit" });
  const state = useAtomValue(rebuildNicheAtom);
  const niche = AsyncResult.getOrElse(result, () => null);
  if (niche === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs text-muted-foreground">
      <span className="text-foreground">niche</span>
      {niche.handles.length === 0 ? (
        <span>no reply history yet</span>
      ) : (
        niche.handles.map((h) => (
          <span key={h.handle}>
            @{h.handle} ({h.replies})
          </span>
        ))
      )}
      {niche.topics.length > 0 ? <span>· {niche.topics.join(", ")}</span> : null}
      {AsyncResult.isFailure(state) ? (
        <span className="text-error-foreground">{errorText(state.cause)}</span>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto"
        disabled={state.waiting}
        onClick={() => void rebuild().then(refresh)}
      >
        {state.waiting ? "Rebuilding…" : "Rebuild niche"}
      </Button>
    </div>
  );
}

export function Targets() {
  const result = useAtomValue(targetsAtom);
  const load = useAtomSet(targetsAtom);
  const free = useQuote({ kind: "engageTargets" })?.cached === true;
  const initial = AsyncResult.isInitial(result);
  // Opening the tab only shows what the cache already holds; a paid search waits for the click.
  useEffect(() => {
    if (free && initial) load();
  }, [free, initial, load]);
  return (
    <div className="flex flex-col gap-2">
      <NicheLine />
      {AsyncResult.match(result, {
        onInitial: ({ waiting }) => (
          <Empty>
            {waiting
              ? "Searching your keywords…"
              : "Refresh targets to search your keywords for posts worth a reply."}
          </Empty>
        ),
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <Empty>No targets. Add keywords in Settings or use Find keywords, then refresh.</Empty>
          ) : (
            value.map((t) => <TargetRow key={t.post.postId} target={t} />)
          ),
      })}
    </div>
  );
}
