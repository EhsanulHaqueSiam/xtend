import { useAtomSet } from "@effect/atom-react";
import { postCostUsd, type XPost } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { useRates } from "../../state/costs";
import { draftReplyAtom, likeAtom, sendReplyAtom } from "../../state/engage";
import { cn } from "../../lib/utils";
import { errorText } from "../analyze/ui";
import { Cost, Section } from "../ui/layout";
import { xInput } from "../x";
import { pill, pillSolidPriced } from "./triage";

/** What the user did with one post here: drafts, the reply text, and what already went out. */
export interface Work {
  readonly drafts: ReadonlyArray<string>;
  readonly text: string;
  readonly busy: "draft" | "reply" | "like" | null;
  readonly error: string | null;
  readonly replied: boolean;
  readonly liked: boolean;
}

export type Patch = (change: Partial<Work>) => void;

const idle: Work = { drafts: [], text: "", busy: null, error: null, replied: false, liked: false };

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

/** A reply to one post: AI drafts to pick from, the text, and Reply and Like with their prices. */
export function ReplyBox({
  post,
  work,
  patch,
}: {
  readonly post: XPost;
  readonly work: Work;
  readonly patch: Patch;
}) {
  const draft = useAtomSet(draftReplyAtom, { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom, { mode: "promiseExit" });
  const like = useAtomSet(likeAtom, { mode: "promiseExit" });
  const rates = useRates();
  const { drafts, text, busy, error, replied, liked } = work;

  const onDraft = async () => {
    patch({ busy: "draft", error: null });
    const exit = await draft(post);
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
    patch({ busy: "like", error: null });
    const exit = await like(post.postId);
    patch(
      Exit.isFailure(exit)
        ? { busy: null, error: errorText(exit.cause) }
        : { busy: null, liked: true },
    );
  };

  return (
    <Section
      title="Reply"
      aside={
        drafts.length > 1 ? (
          <span className="flex items-center gap-3" role="group" aria-label="Drafts">
            {drafts.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={d === text}
                className="cursor-pointer font-mono text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground"
                onClick={() => patch({ text: d })}
              >
                {String.fromCharCode(65 + i)}
              </button>
            ))}
          </span>
        ) : undefined
      }
    >
      <textarea
        className={cn(xInput, "min-h-24 resize-y text-[13.5px] leading-relaxed")}
        value={text}
        maxLength={280}
        placeholder="Write a reply, or draft one"
        disabled={replied}
        onChange={(e) => patch({ text: e.target.value })}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={pillSolidPriced}
          disabled={busy !== null || replied || text.trim() === "" || rates === null}
          onClick={() => void onReply()}
        >
          <TextMorph duration={250}>
            {replied ? "Replied" : busy === "reply" ? "Replying…" : "Reply"}
          </TextMorph>
          {replied ? null : rates === null ? (
            <Cost label="…" />
          ) : (
            <Cost usd={postCostUsd(rates, text)} />
          )}
        </button>
        <button
          type="button"
          className={pill}
          disabled={busy !== null || replied}
          onClick={() => void onDraft()}
        >
          <TextMorph duration={250}>
            {busy === "draft" ? "Drafting…" : drafts.length > 0 ? "Draft again" : "Draft with AI"}
          </TextMorph>
        </button>
        <button
          type="button"
          className={pill}
          disabled={busy !== null || liked || rates === null}
          onClick={() => void onLike()}
        >
          <TextMorph duration={250}>
            {liked ? "Liked" : busy === "like" ? "Liking…" : "Like"}
          </TextMorph>
          {liked ? null : rates === null ? <Cost label="…" /> : <Cost usd={rates.like} />}
        </button>
      </div>
      {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}
    </Section>
  );
}
