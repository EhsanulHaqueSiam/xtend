import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnginePost } from "@xtend/contracts";

import { grokDrawerAtom, grokWriteAtom, xGrokExplain, xGrokOpenNew } from "../../state/grok";
import { xUrlAtom } from "../../state/x";
import { useXPress } from "./useXPress";

/**
 * "Explain this post" for the user's click: Grok docks beside the screen and X's own Grok button
 * on the post asks X's analysis of it. Where X draws no such button for the account, X's Grok
 * opens on a new chat with the post's link in the box, for the user to send.
 */
export function useExplainPost() {
  const { blocked, setToast } = useXPress();
  const setDrawer = useAtomSet(grokDrawerAtom);
  const setWrite = useAtomSet(grokWriteAtom);
  const xUrl = useAtomValue(xUrlAtom);
  return async (post: EnginePost) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    const ref = { postId: post.postId, handle: post.author.handle };
    setDrawer((d) => ({ from: d?.from ?? xUrl, post: ref }));
    if ((await xGrokExplain(ref)) !== null) return;
    if ((await xGrokOpenNew()) === null)
      return setToast({ text: "X did not open Grok. Try again in a moment." });
    setWrite((w) =>
      w.send === null ? { ...w, draft: `https://x.com/${ref.handle}/status/${ref.postId}` } : w,
    );
    setToast({ text: "X shows no Explain this post here: send its link to Grok yourself." });
  };
}
