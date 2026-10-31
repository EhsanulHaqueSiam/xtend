import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { createDraftAtom, postNowAtom } from "../../state/compose";
import { settingsAtom } from "../../state/settings";
import { failText } from "../compose/AssistPanel";
import { toastAtom } from "../ui/toast";
import { Avatar } from "./XPostView";

const LIMIT = 280;

/**
 * X's "What's happening?" at the top of Home. Post is one click through the user's own session,
 * free, the way Compose's Post now goes; with session actions off, or for anything longer than
 * one post, the text moves to Compose, where the lane and its price are shown.
 */
export function HomeComposer({ avatarUrl }: { readonly avatarUrl: string | null }) {
  const navigate = useNavigate();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const create = useAtomSet(createDraftAtom, { mode: "promiseExit" });
  const postNow = useAtomSet(postNowAtom, { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const session = settings?.sessionPostingEnabled === true;
  const tooLong = text.length > LIMIT;
  const handOff = () => void navigate({ href: `/compose?text=${encodeURIComponent(text)}` });

  const post = async () => {
    if (text.trim() === "" || busy) return;
    if (!session || tooLong) return handOff();
    setBusy(true);
    const draft = await create({ blocks: [{ text: text.trim() }] });
    const exit = Exit.isSuccess(draft) ? await postNow(draft.value.id) : draft;
    setBusy(false);
    if (Exit.isFailure(exit)) return setToast({ text: `Not posted: ${failText(exit.cause)}` });
    setText("");
    setToast({ text: "Posted on X" });
  };

  return (
    <div
      data-x="composer"
      className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 border-b border-border px-4 pt-3"
    >
      <Avatar url={avatarUrl} size={40} />
      <div>
        <textarea
          aria-label="Post text"
          placeholder="What's happening?"
          rows={text === "" ? 1 : 3}
          className="block w-full resize-none bg-transparent py-2 text-[20px] leading-6 outline-hidden placeholder:text-[#71767b]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void post();
            }
          }}
        />
        <div className="flex items-center gap-3 border-t border-border py-2.5">
          <button
            type="button"
            className="cursor-pointer text-[13px] text-[#1d9bf0] hover:underline"
            onClick={handOff}
          >
            Media, poll or thread in Compose
          </button>
          <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
            {text === "" ? (session ? "free · your session" : "") : `${text.length}/${LIMIT}`}
          </span>
          <button
            type="button"
            disabled={text.trim() === "" || busy}
            className="h-9 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background transition-opacity duration-150 disabled:cursor-default disabled:opacity-50"
            onClick={() => void post()}
          >
            {session && !tooLong ? "Post" : "Continue in Compose"}
          </button>
        </div>
      </div>
    </div>
  );
}
