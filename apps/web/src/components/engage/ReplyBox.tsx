import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { postCostUsd, type ReplyTone, type XPost } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { usd, useQuote, useRates } from "../../state/costs";
import { draftReplyAtom, likeAtom, sendReplyAtom } from "../../state/engage";
import { settingsAtom } from "../../state/settings";
import { cn } from "../../lib/utils";
import { errorText } from "../analyze/ui";
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
 * Work per id (a post, a person), owned by the screen rather than the detail
 * column, so a call keeps landing and its text survives while the user moves to
 * the next item and back. `idle` is an item's work before anything happened.
 */
export function useWorkBy<Id, W extends object>(idle: W) {
  const [work, setWork] = useState<ReadonlyMap<Id, W>>(new Map());
  const get = (id: Id, seed?: Partial<W>): W => work.get(id) ?? { ...idle, ...seed };
  const patch =
    (id: Id, seed?: Partial<W>) =>
    (change: Partial<W>): void =>
      setWork((m) => new Map(m).set(id, { ...(m.get(id) ?? { ...idle, ...seed }), ...change }));
  return { get, patch } as const;
}

/** Reply work per post id. */
export const useWork = () => useWorkBy<string, Work>(idle);

/** The chooser's tones, in the order the spec shows them. */
const TONES: ReadonlyArray<{ readonly tone: ReplyTone; readonly label: string }> = [
  { tone: "agree", label: "Agree" },
  { tone: "add", label: "Add a point" },
  { tone: "ask", label: "Ask" },
  { tone: "contrarian", label: "Contrarian" },
  { tone: "sarcastic", label: "Sarcastic" },
  { tone: "warm", label: "Warm" },
  { tone: "short", label: "Short" },
];

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
  // The service sends a clicked reply through the session while that lane is on, whichever client
  // clicked, and the button says so. Null until settings arrive: until then the price is unknown.
  const viaSession = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(settingsAtom), (s) => s.sessionPostingEnabled),
    () => null,
  );
  const replyPriced = viaSession === true || (viaSession === false && rates !== null);
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
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Tone">
        <button
          type="button"
          className={pill}
          aria-pressed={tone === null}
          disabled={busy !== null || replied}
          onClick={() => patch({ tone: null, drafts: [] })}
        >
          Write my own
        </button>
        {TONES.map((t) => (
          <button
            key={t.tone}
            type="button"
            className={pill}
            aria-pressed={tone === t.tone}
            disabled={busy !== null || replied || assistQuote === null}
            onClick={() => void onDraft(t.tone)}
          >
            {busy === "draft" && tone === t.tone ? "Drafting…" : t.label}
          </button>
        ))}
      </div>
      {drafts.length > 0 ? (
        <ol className="mb-2 divide-y divide-border border-y border-border" aria-label="Drafts">
          {drafts.map((d, i) => (
            <li key={d}>
              <button
                type="button"
                aria-pressed={d === text}
                className="flex w-full cursor-pointer gap-2.5 py-1.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground"
                disabled={replied}
                onClick={() => patch({ text: d })}
              >
                <span className="font-mono text-xs">{String.fromCharCode(65 + i)}</span>
                <span>{d}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <textarea
        className={cn(inputClass, "min-h-24 resize-y px-3 py-2 text-[13.5px] leading-relaxed")}
        value={text}
        maxLength={280}
        placeholder={tone === null ? "Write your reply" : "Pick a draft above, or edit it here"}
        // Locked while sending: text typed now would not be what went out.
        disabled={replied || busy === "reply"}
        onChange={(e) => patch({ text: e.target.value })}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={pillSolid}
          disabled={busy !== null || replied || text.trim() === "" || !replyPriced}
          onClick={() => void onReply()}
        >
          <TextMorph duration={250}>
            {replied ? "Replied" : busy === "reply" ? "Replying…" : "Reply"}
          </TextMorph>
          {replied ? null : viaSession === true ? (
            <Cost tone="solid" label="free · your session" />
          ) : !replyPriced || rates === null ? (
            <Cost tone="solid" label="…" />
          ) : (
            <Cost tone="solid" usd={postCostUsd(rates, text)} />
          )}
        </button>
        {tone === null ? null : (
          <button
            type="button"
            className={pill}
            disabled={busy !== null || replied || assistQuote === null}
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
