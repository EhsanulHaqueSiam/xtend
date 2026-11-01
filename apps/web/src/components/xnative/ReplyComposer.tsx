import { useAtomSet } from "@effect/atom-react";
import type { EnginePost, PostRead } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { draftReplyAtom, readPostAtom, sendReplyAtom } from "../../state/engage";
import { toXPost } from "../../state/engine";
import { failText } from "../compose/AssistPanel";
import { toastAtom } from "../ui/toast";
import { useOwnAvatar } from "./HomeComposer";
import { Avatar } from "./XPostView";

const MODES = ["Your own", "With help", "Angles"] as const;
type Mode = (typeof MODES)[number];

/** What the user can say the post really is when the read is wrong; the angles follow it. */
const CORRECTIONS = ["Sincere", "Sarcastic", "Joking", "Asking for help", "Announcing"] as const;

/**
 * Replying, after reading the post. The read (what the post is, from its text, image and thread)
 * runs on open, free on the user's login. Angles are replies written for this post; With help
 * reworks the user's own words; Your own touches nothing. The reply goes through the session.
 */
export function ReplyComposer({
  post,
  thread,
  onSent,
}: {
  readonly post: EnginePost;
  readonly thread: ReadonlyArray<string>;
  readonly onSent: () => void;
}) {
  const readPost = useAtomSet(readPostAtom(post.postId), { mode: "promiseExit" });
  const help = useAtomSet(draftReplyAtom(post.postId), { mode: "promiseExit" });
  const send = useAtomSet(sendReplyAtom(post.postId), { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  const [mode, setMode] = useState<Mode>("Angles");
  const [read, setRead] = useState<PostRead | null>(null);
  const [reading, setReading] = useState(false);
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const avatarUrl = useOwnAvatar();
  // A video's or GIF's url is its poster frame: still the best look the model gets at it.
  const images = post.media.map((m) => m.url);

  const runRead = async (correction?: string) => {
    setReading(true);
    setError(null);
    const exit = await readPost({ post: toXPost(post), images, thread, correction });
    setReading(false);
    if (Exit.isSuccess(exit)) setRead(exit.value);
    else setError(failText(exit.cause));
  };
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads the post from the service once per post: reading is free, and the angles are the point of opening the composer.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect, react/exhaustive-effect-dependencies -- once per post, starting with the reading state: runRead is rebuilt every render, and reading again would replace the angles shown.
    void runRead();
  }, [post.postId]);

  const pick = (angle: string) => {
    setText(angle);
    box.current?.focus();
  };
  const suggest = async () => {
    setBusy(true);
    const exit = await help({ post: toXPost(post), tone: null, own: text });
    setBusy(false);
    if (Exit.isSuccess(exit)) setSuggestions(exit.value.map((d) => d.text));
    else setError(failText(exit.cause));
  };
  const reply = async () => {
    if (text.trim() === "" || busy) return;
    setBusy(true);
    const exit = await send({ post: toXPost(post), text: text.trim() });
    setBusy(false);
    if (Exit.isFailure(exit)) return setError(failText(exit.cause));
    if (exit.value.error !== null) return setError(exit.value.error);
    setText("");
    setSuggestions([]);
    setToast({ text: "Replied on X" });
    onSent();
  };

  const canReply = !busy && text.trim() !== "" && text.length <= 280;
  return (
    <section
      data-x="reply"
      className="border-b border-border px-4 py-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void reply();
        } else if (
          mode === "Angles" &&
          read !== null &&
          /^[1-4]$/.test(e.key) &&
          e.target !== box.current
        ) {
          const angle = read.angles[Number(e.key) - 1];
          if (angle !== undefined) pick(angle.text);
        }
      }}
    >
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-x-3">
        <Avatar url={avatarUrl} size={40} />
        <textarea
          ref={box}
          aria-label="Your reply"
          placeholder={
            mode === "Your own" ? "Post your reply. No AI touches it." : "Post your reply"
          }
          rows={text === "" ? 1 : 4}
          className="w-full resize-none bg-transparent py-2 text-[20px] leading-6 outline-hidden placeholder:text-[#71767b]"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          disabled={!canReply}
          className="mt-0.5 h-9 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background transition-opacity duration-150 disabled:cursor-default disabled:opacity-50"
          onClick={() => void reply()}
        >
          Reply
        </button>
      </div>

      <div className="mt-2 ml-[52px] flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <div
            role="tablist"
            aria-label="How to write"
            className="inline-flex gap-0.5 rounded-full bg-white/[0.05] p-0.5"
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === mode}
                className="h-6 cursor-pointer rounded-full px-2.5 text-xs text-[#71767b] aria-selected:bg-white/10 aria-selected:text-foreground"
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-2xs text-muted-foreground tabular-nums">
            {text.length}/280 · free · your session · ⌘↵
          </span>
        </div>

        {mode === "Angles" ? (
          <>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-[#71767b]">
              {read === null ? (
                reading ? (
                  "Reading the post."
                ) : (
                  "Not read yet."
                )
              ) : (
                <>
                  <b className="font-semibold text-foreground">{read.read}</b>
                  {read.signals.map((sig) => (
                    <span key={sig} className="rounded-full bg-white/[0.07] px-2 text-xs">
                      {sig}
                    </span>
                  ))}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
                    Not right?
                    {CORRECTIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        disabled={reading}
                        className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
                        onClick={() => void runRead(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </span>
                </>
              )}
            </p>
            {read === null ? null : (
              <ol className="flex flex-col">
                {read.angles.map((a, i) => (
                  <li key={a.label}>
                    <button
                      type="button"
                      className={cn(
                        "grid w-full cursor-pointer grid-cols-[18px_1fr] gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.04]",
                        text === a.text && "bg-white/[0.06]",
                      )}
                      onClick={() => pick(a.text)}
                    >
                      <span className="pt-0.5 font-mono text-2xs text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="text-[14px] leading-5">
                        <span className="text-[#71767b]">{a.label} · </span>
                        {a.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : null}

        {mode === "With help" ? (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy || text.trim() === ""}
              className="w-fit cursor-pointer text-[13px] text-[#1d9bf0] hover:underline disabled:cursor-default disabled:opacity-50"
              onClick={() => void suggest()}
            >
              Suggest better versions of what I wrote
            </button>
            {suggestions.map((sug) => (
              <button
                key={sug}
                type="button"
                className="cursor-pointer rounded-xl px-2 py-1.5 text-left text-[14px] leading-5 hover:bg-white/[0.04]"
                onClick={() => setText(sug)}
              >
                {sug}
              </button>
            ))}
          </div>
        ) : null}

        {error !== null ? <p className="text-xs text-error-foreground">{error}</p> : null}
      </div>
    </section>
  );
}
