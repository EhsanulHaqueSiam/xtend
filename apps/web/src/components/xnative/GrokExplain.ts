import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnginePost } from "@xtend/contracts";

import { grokDrawerAtom, grokWriteAtom, xGrokExplain, xGrokOpenNew } from "../../state/grok";
import { xUrlAtom } from "../../state/x";
import { useXPress } from "./useXPress";

/** The Explain in flight: one at a time, ended when its drawer goes. */
let explaining: AbortController | null = null;

/** Ends the Explain in flight, if any: nothing more of it reaches X. */
export const endExplain = () => {
  explaining?.abort();
  explaining = null;
};

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
    endExplain();
    const run = new AbortController();
    explaining = run;
    const ref = { postId: post.postId, handle: post.author.handle };
    setDrawer((d) => ({ from: d?.from ?? xUrl, post: ref }));
    // Only where X drew no Grok button, and the Explain is still the user's: the link fallback.
    if ((await xGrokExplain(ref, run.signal)) !== "none" || run.signal.aborted) return;
    const opened = await xGrokOpenNew();
    if (run.signal.aborted) return;
    if (opened === null) return setToast({ text: "X did not open Grok. Try again in a moment." });
    setWrite((w) =>
      w.send === null ? { ...w, draft: `https://x.com/${ref.handle}/status/${ref.postId}` } : w,
    );
    setToast({ text: "X shows no Explain this post here: send its link to Grok yourself." });
  };
}
