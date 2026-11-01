import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { charCount, POST_LIMIT } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { CalendarClock, Image, ListChecks, ListPlus } from "lucide-react";
import { useState } from "react";

import { createDraftAtom, sessionPostNowAtom } from "../../state/compose";
import { engineAtom } from "../../state/engine";
import { settingsAtom } from "../../state/settings";
import { failText } from "../compose/AssistPanel";
import { toastAtom } from "../ui/toast";
import { Avatar } from "./XPostView";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The user's own face: X's signed-in account, else any of their posts the engine has seen. */
export const useOwnAvatar = () => {
  const engine = useAtomValue(engineAtom);
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  if (engine.viewer?.avatarUrl != null) return engine.viewer.avatarUrl;
  if (handle === null) return null;
  const lower = handle.toLowerCase();
  for (const p of engine.posts.values())
    if (p.author.handle.toLowerCase() === lower) return p.avatarUrl;
  return null;
};

/**
 * One post through the user's own session, free, for their click on Post; `quoteUrl` rides under
 * the text, where X makes it a quote. Resolves true once X has it, otherwise says why and resolves
 * false. The service refuses it rather than take the paid API lane when the session cannot post.
 */
export const useSessionPost = () => {
  const create = useAtomSet(createDraftAtom, { mode: "promiseExit" });
  const postNow = useAtomSet(sessionPostNowAtom, { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  return async (text: string, quoteUrl: string | null = null) => {
    const draft = await create({ blocks: [{ text }], quoteUrl });
    const exit = Exit.isSuccess(draft) ? await postNow(draft.value.id) : draft;
    if (Exit.isFailure(exit))
      return (setToast({ text: `Not posted: ${failText(exit.cause)}` }), false);
    // The publisher answers with the draft: only "posted" means X has it; the text stays otherwise.
    if (exit.value.status !== "posted")
      return (setToast({ text: `Not posted: ${exit.value.error ?? exit.value.status}` }), false);
    setToast({ text: "Posted on X" });
    return true;
  };
};

/**
 * X's "What's happening?" at the top of Home. Post is one click through the user's own session,
 * free, the way Compose's Post now goes; with session actions off, or for anything longer than
 * one post, the text moves to Compose, where the lane and its price are shown.
 */
export function HomeComposer() {
  const avatarUrl = useOwnAvatar();
  const navigate = useNavigate();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const sessionPost = useSessionPost();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const session = settings?.sessionPostingEnabled === true;
  const length = charCount(text);
  const tooLong = length > POST_LIMIT;
  const handOff = () => void navigate({ href: `/compose?text=${encodeURIComponent(text)}` });

  const post = async () => {
    if (text.trim() === "" || busy) return;
    if (!session || tooLong) return handOff();
    setBusy(true);
    const posted = await sessionPost(text.trim());
    setBusy(false);
    if (posted) setText("");
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
        <div className="flex items-center gap-3.5 border-t border-border py-2.5">
          {(
            [
              [Image, "Add media in Compose"],
              [ListChecks, "Add a poll in Compose"],
              [CalendarClock, "Schedule in Compose"],
              [ListPlus, "Make a thread in Compose"],
            ] as const
          ).map(([Icon, label]) => (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={label}
                    className="-m-1.5 grid size-[34px] cursor-pointer place-items-center rounded-full text-[#1d9bf0] transition-colors duration-150 hover:bg-[#1d9bf0]/10"
                    onClick={handOff}
                  />
                }
              >
                <Icon className="size-[18px]" />
              </TooltipTrigger>
              <TooltipPopup>{label}</TooltipPopup>
            </Tooltip>
          ))}
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
      </div>
    </div>
  );
}
