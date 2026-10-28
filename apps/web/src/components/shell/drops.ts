import { useAtomRefresh, useAtomSet } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { XPost } from "@xtend/contracts";
import { Atom } from "effect/reactivity";

import type { DraggedPost } from "../../lib/drag";
import { addPersonAtom } from "../../state/leads";
import { collectionsAtom, deleteSavedAtom, savePostAtom, swipeFileAtom } from "../../state/library";
import { observedPostAtom } from "../../state/observations";
import { watchAddAtom, watchListAtom, watchRemoveAtom } from "../../state/scores";
import { errorMessage } from "../library/shared";
import { toastAtom } from "../ui/toast";

/** True while a link drag is over the window, so the sidebar can show where it may land. */
export const linkDragAtom = Atom.make(false);

/** What dropping a post on a tool does, in the words the sidebar shows beside the row. */
export const DROP_VERBS: Readonly<Record<string, string>> = {
  "/compose": "quote",
  "/library": "save",
  "/leads": "add author",
  "/scores": "watch author",
};

/**
 * Runs a drop and reports it in one toast with Undo where the service can
 * reverse it. Reads only what the session already observed; a drop never
 * calls X.
 */
export function useDropPost() {
  const navigate = useNavigate();
  const setToast = useAtomSet(toastAtom);
  const observe = useAtomSet(observedPostAtom, { mode: "promise" });
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const unsave = useAtomSet(deleteSavedAtom, { mode: "promise" });
  const refreshSwipe = useAtomRefresh(swipeFileAtom(""));
  const refreshCollections = useAtomRefresh(collectionsAtom);
  const addPerson = useAtomSet(addPersonAtom, { mode: "promise" });
  const watch = useAtomSet(watchAddAtom, { mode: "promise" });
  const unwatch = useAtomSet(watchRemoveAtom, { mode: "promise" });
  const refreshWatch = useAtomRefresh(watchListAtom);

  return (route: string, post: DraggedPost) => {
    const run = async () => {
      const observed = route === "/compose" ? undefined : await observe(post);
      switch (route) {
        case "/compose":
          void navigate({ href: `/compose?quote=${encodeURIComponent(post.url)}` });
          return { text: "Quoting in Compose" };
        case "/library": {
          if (observed === undefined) return { text: "Not seen yet. Open it on X and press Save." };
          const full: XPost = {
            ...observed,
            url: post.url,
            lang: null,
            author: { ...observed.author, avatarUrl: null },
          };
          const saved = await save({ post: full, collectionId: null });
          refreshSwipe();
          refreshCollections();
          return {
            text: "Saved to Library",
            undo: () => unsave(saved.id).then(refreshSwipe).then(refreshCollections),
          };
        }
        case "/leads":
          await addPerson({
            handle: post.handle,
            name: observed?.author.name ?? post.handle,
            userId: observed?.author.userId ?? null,
            followers: observed?.author.followers ?? null,
            bio: "",
            source: "drop",
          });
          return { text: `Added @${post.handle} to Leads` };
        case "/scores":
          await watch(post.handle);
          refreshWatch();
          return {
            text: `Watching @${post.handle} in Scores`,
            undo: () => unwatch(post.handle).then(refreshWatch),
          };
        default:
          return { text: "Nothing to do here" };
      }
    };
    void run().then(setToast, (e: unknown) => setToast({ text: errorMessage(e) }));
  };
}
