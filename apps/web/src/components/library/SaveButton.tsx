import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { XPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Bookmark } from "lucide-react";
import { useState } from "react";

import { collectionsAtom, savePostAtom, swipeFileAtom } from "../../state/library";
import { Button } from "../ui/button";
import { errorMessage } from "./shared";

/** "Save" on any post: to the swipe file alone or into one collection (a post may be in several). */
export function SaveButton({ post }: { readonly post: XPost }) {
  const collections = useAtomValue(collectionsAtom);
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const refreshSwipe = useAtomRefresh(swipeFileAtom(""));
  const refreshCollections = useAtomRefresh(collectionsAtom);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (collectionId: number | null, label: string) => {
    setOpen(false);
    try {
      await save({ post, collectionId });
      setStatus(`Saved to ${label}`);
      refreshSwipe();
      refreshCollections();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  };

  const list = AsyncResult.getOrElse(collections, () => []).filter((c) => !c.builtIn);
  return (
    <span className="relative inline-flex items-center gap-1.5">
      <Button variant="outline" size="xs" onClick={() => setOpen((o) => !o)}>
        <Bookmark /> Save
      </Button>
      {status !== null ? <span className="text-2xs text-muted-foreground">{status}</span> : null}
      {open ? (
        <span className="absolute top-full left-0 z-20 mt-1 flex min-w-40 flex-col rounded-md border border-border bg-popover p-1 shadow-md">
          <Button
            variant="ghost"
            size="xs"
            className="justify-start"
            onClick={() => void run(null, "swipe file")}
          >
            Swipe file
          </Button>
          {list.map((c) => (
            <Button
              key={c.id}
              variant="ghost"
              size="xs"
              className="justify-start"
              onClick={() => void run(c.id, c.name)}
            >
              {c.name}
            </Button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
