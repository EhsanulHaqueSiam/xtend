import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { XPost } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Bookmark, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { Cost } from "../ui/layout";
import { collectionsAtom, savedIdsAtom, savePostAtom, swipeFileAtom } from "../../state/library";
import { Menu, MenuItem } from "../ui/menu";
import { xPill, xPillSm, xPillSolid } from "../x";
import { errorMessage } from "./shared";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const small = "[&_svg]:size-3.5";

/** The ids of saved posts, so a card can say Saved before anyone clicks. */
export function useSavedIds(): ReadonlySet<string> {
  const saved = useAtomValue(savedIdsAtom);
  return useMemo(() => new Set(AsyncResult.getOrElse(saved, () => [])), [saved]);
}

/** Refreshes what a save changes: the swipe file and the collection counts. */
function useSave() {
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const refreshSwipe = useAtomRefresh(swipeFileAtom(""));
  const refreshCollections = useAtomRefresh(collectionsAtom);
  return async (post: XPost, collectionId: number | null) => {
    await save({ post, collectionId });
    refreshSwipe();
    refreshCollections();
  };
}

/** One click into the swipe file, for a card's footer. The label morphs to Saved. */
export function QuickSave({ post, saved }: { readonly post: XPost; readonly saved: boolean }) {
  const save = useSave();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSaved = saved || done;
  return (
    <Tooltip disabled={error === null}>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <button
          type="button"
          className={cn(
            isSaved ? xPill : xPillSolid,
            xPillSm,
            small,
            isSaved && "text-muted-foreground disabled:opacity-100",
          )}
          disabled={isSaved}
          onClick={() =>
            void save(post, null).then(
              () => setDone(true),
              (e: unknown) => setError(errorMessage(e)),
            )
          }
        >
          <TextMorph duration={250}>
            {isSaved ? "Saved" : error !== null ? "Retry" : "Save"}
          </TextMorph>
        </button>
      </TooltipTrigger>
      <TooltipPopup>{error}</TooltipPopup>
    </Tooltip>
  );
}

/** Save into the swipe file or one collection (a post may be in several). */
export function SaveButton({
  post,
  saved = false,
}: {
  readonly post: XPost;
  readonly saved?: boolean;
}) {
  const collections = useAtomValue(collectionsAtom);
  const save = useSave();
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (collectionId: number | null, label: string) => {
    setError(null);
    save(post, collectionId).then(
      () => setSavedTo(label),
      (e: unknown) => setError(errorMessage(e)),
    );
  };

  const list = AsyncResult.getOrElse(collections, () => []).filter((c) => !c.builtIn);
  const label = savedTo !== null ? `Saved to ${savedTo}` : saved ? "Saved" : "Save";
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Menu
        trigger={
          <button
            type="button"
            className={cn(saved || savedTo !== null ? xPill : xPillSolid, xPillSm, small)}
          >
            <Bookmark />
            <TextMorph duration={250}>{label}</TextMorph>
            <ChevronDown className="opacity-60" />
          </button>
        }
      >
        <MenuItem onClick={() => run(null, "Swipe file")}>Swipe file</MenuItem>
        {list.map((c) => (
          <MenuItem key={c.id} onClick={() => run(c.id, c.name)}>
            <span className="truncate">{c.name}</span>
            <span className="ml-auto font-mono text-2xs tabular-nums">{c.posts}</span>
          </MenuItem>
        ))}
      </Menu>
      {error !== null ? (
        <span className="truncate text-2xs text-error-foreground">{error}</span>
      ) : null}
    </span>
  );
}

/** Saves the post so Compose can read it back by id, then opens the composer on it. */
export function RemixButton({ post }: { readonly post: XPost }) {
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const navigate = useNavigate();
  // A failed save stays on the button: Compose would open with nothing to remix.
  const [error, setError] = useState<string | null>(null);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(xPill, xPillSm, small, error !== null && "text-error-foreground")}
            onClick={() =>
              void save({ post, collectionId: null }).then(
                () => navigate({ href: `/compose?inspire=${post.postId}` }),
                (e: unknown) => setError(errorMessage(e)),
              )
            }
          />
        }
      >
        <TextMorph duration={250}>{error !== null ? "Retry" : "Remix in Compose"}</TextMorph>
        {error !== null ? null : <Cost usd={0} />}
      </TooltipTrigger>
      <TooltipPopup>
        {error ?? "Write your own in Compose, with this post as inspiration"}
      </TooltipPopup>
    </Tooltip>
  );
}
