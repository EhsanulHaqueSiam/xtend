import { Dialog } from "@base-ui/react/dialog";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { charCount, POST_LIMIT } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { X } from "lucide-react";
import { useState } from "react";

import { settingsAtom } from "../../state/settings";
import { useOwnAvatar, useSessionPost } from "./HomeComposer";
import { Avatar, postUrl, QuoteBox, quoteAtom } from "./XPostView";

/**
 * X's quote composer, opened from the Repost popover's Quote: the user's comment over the quoted
 * post. Post is one click through the user's own session, free; with session actions off, or a
 * comment longer than one post, the quote moves to Compose, where the lane and its price show.
 */
export function QuoteComposer() {
  const [quoted, setQuoted] = useAtom(quoteAtom);
  const avatarUrl = useOwnAvatar();
  const navigate = useNavigate();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const sessionPost = useSessionPost();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const session = settings?.sessionPostingEnabled === true;
  // X weighs the quoted link under the comment (23) with it, as the publisher sends them.
  const length = quoted === null ? 0 : charCount(`${text}\n${postUrl(quoted)}`);
  const tooLong = length > POST_LIMIT;
  const close = () => {
    setQuoted(null);
    setText("");
  };
  const handOff = (url: string) => {
    close();
    const comment = text === "" ? "" : `&text=${encodeURIComponent(text)}`;
    void navigate({ href: `/compose?quote=${encodeURIComponent(url)}${comment}` });
  };
  const post = async () => {
    if (quoted === null || text.trim() === "" || busy) return;
    const url = postUrl(quoted);
    if (!session || tooLong) return handOff(url);
    setBusy(true);
    const posted = await sessionPost(text.trim(), url);
    setBusy(false);
    if (posted) close();
  };

  return (
    // Held open while posting: the answer clears the box, so it must still be this quote's.
    <Dialog.Root open={quoted !== null} onOpenChange={(open) => !open && !busy && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[#5b7083]/40" />
        <Dialog.Popup
          aria-label="Quote"
          className="fixed top-[5vh] left-1/2 z-50 max-h-[90vh] w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-y-auto rounded-2xl bg-black px-4 pt-3 outline-hidden"
        >
          <Dialog.Close
            aria-label="Close"
            className="-m-1.5 grid size-[34px] cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
          >
            <X className="size-5" />
          </Dialog.Close>
          <div className="mt-3 grid grid-cols-[40px_minmax(0,1fr)] gap-x-3">
            <Avatar url={avatarUrl} size={40} />
            <div className="flex min-w-0 flex-col gap-3 pb-3">
              <textarea
                aria-label="Your comment"
                placeholder="Add a comment"
                rows={2}
                autoFocus
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
              {quoted === null ? null : <QuoteBox quoted={quoted} onOpen={undefined} />}
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-border py-2.5">
            <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
              {text === "" ? (session ? "free · your session" : "") : `${length}/${POST_LIMIT}`}
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
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
