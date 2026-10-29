import { useAtomSet } from "@effect/atom-react";
import { postCostUsd, type ReplyTone, type XPost } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { usd, useQuote, useRates } from "../../state/costs";
import { draftReplyAtom, likeAtom, sendReplyAtom } from "../../state/engage";
import { useSessionLane } from "../../state/settings";
import { cn } from "../../lib/utils";
import { errorText } from "../analyze/ui";
import { Candidates, ToneRow } from "../ui/assist-choice";
import { inputClass } from "../ui/field";
import { Cost, Section } from "../ui/layout";
import { pill, pillSolid } from "./triage";

/** What the user did with one post here: drafts, the reply text, and what already went out. */
export interface Work {
  /** The taste the drafts were asked for; null is "write my own". */
  readonly tone: ReplyTone | null;
  readonly drafts: ReadonlyArray<string>;
  readonly text: string;
  readonly busy: "draft" | "reply" | "like" | null;
  readonly error: string | null;
  readonly replied: boolean;
  readonly liked: boolean;
  /** What the like cost, quoted before it ran. */
  readonly likedUsd: number;
}

export type Patch = (change: Partial<Work>) => void;

const idle: Work = {
  tone: null,
  drafts: [],
  text: "",
  busy: null,
  error: null,
  replied: false,
  liked: false,
  likedUsd: 0,
};

/**
 * Work per post id, owned by the screen rather than the detail column, so a
 * draft keeps running and its text survives while the user moves to the next
 * post and back.
 */
export function useWork() {
  const [work, setWork] = useState<ReadonlyMap<string, Work>>(new Map());
  const get = (postId: string, seed?: Partial<Work>): Work =>
    work.get(postId) ?? { ...idle, ...seed };
  const patch =
    (postId: string, seed?: Partial<Work>): Patch =>
    (change) =>
      setWork((m) =>
        new Map(m).set(postId, { ...(m.get(postId) ?? { ...idle, ...seed }), ...change }),
      );
  return { get, patch } as const;
}

/**
 * A reply to one post. Assist is a choice: a tone row with "write my own" first, three
 * candidates to pick from, the editor, then Reply and Like with their prices.
 */
export function ReplyBox({
  post,
  work,
  patch,
}: {
  readonly post: XPost;
  readonly work: Work;
  readonly patch: Patch;
}) {
  // One atom per post: a new call on a shared one would interrupt a paid like or reply still
  // in flight for the post the user just left.
  const draft = useAtomSet(draftReplyAtom(post.postId), { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom(post.postId), { mode: "promiseExit" });
  const like = useAtomSet(likeAtom(post.postId), { mode: "promiseExit" });
  const rates = useRates();
  // The service's price: the first like of the day also pays for the account lookup.
  const likeQuote = useQuote({ kind: "like" });
  const assistQuote = useQuote({ kind: "assist" });
  // The service sends a clicked reply through the session while that lane is on; the button says so.
  const viaSession = useSessionLane();
  const { tone, drafts, text, busy, error, replied, liked } = work;

  const onDraft = async (tone: ReplyTone) => {
    patch({ busy: "draft", error: null, tone });
    const exit = await draft({ post, tone });
    if (Exit.isFailure(exit)) return patch({ busy: null, error: errorText(exit.cause) });
    const list = exit.value.map((d) => d.text);
    patch({ busy: null, drafts: list, text: list[0] ?? text });
  };

  const onReply = async () => {
    patch({ busy: "reply", error: null });
    const exit = await send({ post, text });
    if (Exit.isFailure(exit)) return patch({ busy: null, error: errorText(exit.cause) });
    // The service records a failed X write on the row instead of throwing; surface it here.
    patch(
      exit.value.error !== null
        ? { busy: null, error: exit.value.error }
        : { busy: null, replied: true },
    );
  };

  const onLike = async () => {
    // Read before the call: the like itself fills the lookup cache and requotes.
    const price = likeQuote?.usd ?? 0;
    patch({ busy: "like", error: null });
    const exit = await like();
    patch(
      Exit.isFailure(exit)
        ? { busy: null, error: errorText(exit.cause) }
        : { busy: null, liked: true, likedUsd: price },
    );
  };

  return (
    <Section
      title="Reply"
      aside={
        assistQuote === null ? undefined : (
          <Cost label={`3 drafts · ${assistQuote.usd === 0 ? "free" : usd(assistQuote.usd)}`} />
        )
      }
    >
      <div className="mb-2 flex flex-col gap-2">
        <ToneRow
          tone={tone}
          busy={busy === "draft" ? tone : undefined}
          disabled={busy !== null || replied}
          assistDisabled={assistQuote === null}
          onTone={(next) =>
            next === null ? patch({ tone: null, drafts: [] }) : void onDraft(next)
          }
        />
        <Candidates
          drafts={drafts}
          picked={text}
          disabled={replied}
          onPick={(d) => patch({ text: d })}
        />
      </div>
      <textarea
        className={cn(inputClass, "min-h-24 resize-y px-3 py-2 text-[13.5px] leading-relaxed")}
        value={text}
        maxLength={280}
        placeholder={tone === null ? "Write your reply" : "Pick a draft above, or edit it here"}
        disabled={replied}
        onChange={(e) => patch({ text: e.target.value })}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={pillSolid}
          disabled={
            busy !== null || replied || text.trim() === "" || (rates === null && !viaSession)
          }
          onClick={() => void onReply()}
        >
          <TextMorph duration={250}>
            {replied ? "Replied" : busy === "reply" ? "Replying…" : "Reply"}
          </TextMorph>
          {replied ? null : viaSession ? (
            <Cost tone="solid" label="free · your session" />
          ) : rates === null ? (
            <Cost tone="solid" label="…" />
          ) : (
            <Cost tone="solid" usd={postCostUsd(rates, text)} />
          )}
        </button>
        {tone === null ? null : (
          <button
            type="button"
            className={pill}
            disabled={busy !== null || replied}
            onClick={() => void onDraft(tone)}
          >
            Draft again
          </button>
        )}
        <button
          type="button"
          className={pill}
          disabled={busy !== null || liked || likeQuote === null}
          onClick={() => void onLike()}
        >
          <TextMorph duration={250}>
            {liked ? "Liked" : busy === "like" ? "Liking…" : "Like"}
          </TextMorph>
          {liked ? (
            <Cost label={`for ${usd(work.likedUsd)}`} />
          ) : likeQuote === null ? (
            <Cost label="…" />
          ) : (
            <Cost usd={likeQuote.usd} />
          )}
        </button>
      </div>
      {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
    </Section>
  );
}
