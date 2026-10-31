import { useAtomSet } from "@effect/atom-react";
import type { EnginePost, PostRead } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { draftReplyAtom, readPostAtom, sendReplyAtom } from "../../state/engage";
import { toXPost } from "../../state/engine";
import { failText } from "../compose/AssistPanel";
import { Button } from "../ui/button";
import { toastAtom } from "../ui/toast";

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
  // Once per post: reading is free, and the angles are the point of opening the composer.
  useEffect(() => {
    void runRead();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per post, not per render
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
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted-foreground">Read</span>
        {read === null ? (
          <span className="text-muted-foreground">
            {reading ? "Reading the post." : "Not read yet."}
          </span>
        ) : (
          <>
            <b className="font-semibold">{read.read}</b>
            {read.signals.map((s) => (
              <span key={s} className="rounded-md bg-white/[0.07] px-2 py-0.5 text-xs">
                {s}
              </span>
            ))}
          </>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
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
      </div>

      <div
        role="tablist"
        aria-label="How to write"
        className="mt-3 inline-flex gap-0.5 rounded-lg bg-white/[0.04] p-0.5"
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            className="h-6 cursor-pointer rounded-md px-2.5 text-xs text-muted-foreground aria-selected:bg-white/10 aria-selected:text-foreground"
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "Angles" && read !== null ? (
        <ol className="mt-2 flex flex-col gap-1.5">
          {read.angles.map((a, i) => (
            <li key={a.label}>
              <button
                type="button"
                className={cn(
                  "grid w-full cursor-pointer grid-cols-[18px_1fr] gap-2 rounded-lg border px-3 py-2 text-left transition-colors duration-150",
                  text === a.text
                    ? "border-white/35 bg-white/[0.04]"
                    : "border-border hover:border-white/15",
                )}
                onClick={() => pick(a.text)}
              >
                <span className="pt-px font-mono text-2xs text-muted-foreground">{i + 1}</span>
                <span>
                  <span className="block text-xs text-muted-foreground">{a.label}</span>
                  <span className="block text-[13px]">{a.text}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">{read.why}</li>
        </ol>
      ) : null}

      <textarea
        ref={box}
        aria-label="Your reply"
        placeholder={
          mode === "Your own" ? "Write your reply. No AI touches it." : "Write your reply"
        }
        className="mt-3 min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-[14px] leading-relaxed outline-hidden focus:border-white/30"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {mode === "With help" && suggestions.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {suggestions.map((s) => (
            <li
              key={s}
              className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-[13px]"
            >
              <span className="flex-1 text-foreground/85">{s}</span>
              <Button size="xs" variant="outline" onClick={() => setText(s)}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error !== null ? <p className="mt-2 text-xs text-error-foreground">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <span className="mr-auto font-mono text-2xs text-muted-foreground tabular-nums">
          {text.length}/280{mode === "Angles" ? " · 1–4 pick" : ""} · ⌘↵ reply
        </span>
        {mode === "With help" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || text.trim() === ""}
            onClick={() => void suggest()}
          >
            Suggest
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={busy || text.trim() === "" || text.length > 280}
          onClick={() => void reply()}
        >
          Reply
          <span className="font-mono text-2xs opacity-70">free · your session</span>
        </Button>
      </div>
    </section>
  );
}
