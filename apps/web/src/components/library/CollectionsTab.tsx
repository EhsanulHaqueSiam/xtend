import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Collection, SavedPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { fmtDay } from "../../lib/time";
import {
  collectionPostsAtom,
  collectionsAtom,
  createCollectionAtom,
  deleteCollectionAtom,
  deleteSavedAtom,
  removeFromCollectionAtom,
  renameCollectionAtom,
  setNoteAtom,
  swipeFileAtom,
} from "../../state/library";
import { Button } from "../ui/button";
import { InspireButton } from "./SearchTab";
import { Empty, ErrorLine, PostRow, errorMessage, inputClass } from "./shared";

/**
 * A saved post with its note. Used by collections and the swipe file: Remove in a collection
 * takes it out of that one, in the swipe file it deletes it everywhere.
 */
function SavedRow({
  saved,
  collection,
  onChange,
}: {
  readonly saved: SavedPost;
  readonly collection: Collection | undefined;
  readonly onChange: () => void;
}) {
  const setNote = useAtomSet(setNoteAtom, { mode: "promise" });
  const remove = useAtomSet(deleteSavedAtom, { mode: "promise" });
  const unlink = useAtomSet(removeFromCollectionAtom, { mode: "promise" });
  const [note, setNoteText] = useState(saved.note);
  const [error, setError] = useState<string | null>(null);
  const report = (e: unknown) => setError(errorMessage(e));
  return (
    <PostRow
      post={saved.post}
      badge={
        <span className="font-mono text-2xs text-muted-foreground">
          saved {fmtDay(saved.savedAt)}
        </span>
      }
      actions={
        <>
          <InspireButton post={saved.post} />
          {/* Staff picks is read-only, as the service keeps it. */}
          {collection?.builtIn === true ? null : (
            <Button
              variant="ghost-destructive"
              size="xs"
              onClick={() =>
                void (
                  collection === undefined
                    ? remove(saved.id)
                    : unlink({ collectionId: collection.id, savedId: saved.id })
                ).then(onChange, report)
              }
            >
              <Trash2 /> Remove
            </Button>
          )}
          {error !== null ? <span className="text-2xs text-error-foreground">{error}</span> : null}
        </>
      }
    >
      <input
        className={`${inputClass} mt-2`}
        aria-label="Note"
        placeholder="note"
        value={note}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={() => {
          if (note !== saved.note) void setNote({ id: saved.id, note }).catch(report);
        }}
      />
    </PostRow>
  );
}

export function SavedList({
  result,
  collection,
  onChange,
}: {
  readonly result: AsyncResult.AsyncResult<ReadonlyArray<SavedPost>, unknown>;
  /** The collection listed; none is the swipe file. */
  readonly collection?: Collection;
  readonly onChange: () => void;
}) {
  return AsyncResult.match(result, {
    onInitial: () => <Empty>Loading…</Empty>,
    onFailure: (f) => <ErrorLine>{String(f.cause)}</ErrorLine>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <Empty>Nothing saved here yet.</Empty>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 py-2">
          {value.map((s) => (
            <SavedRow key={s.id} saved={s} collection={collection} onChange={onChange} />
          ))}
        </div>
      ),
  });
}

function CollectionPosts({ collection }: { readonly collection: Collection }) {
  const posts = useAtomValue(collectionPostsAtom(collection.id));
  const refresh = useAtomRefresh(collectionPostsAtom(collection.id));
  const refreshAll = useAtomRefresh(swipeFileAtom(""));
  // The sidebar counts each collection's posts.
  const refreshCounts = useAtomRefresh(collectionsAtom);
  return (
    <SavedList
      result={posts}
      collection={collection}
      onChange={() => {
        refresh();
        refreshAll();
        refreshCounts();
      }}
    />
  );
}

export function CollectionsTab() {
  const collections = useAtomValue(collectionsAtom);
  const refresh = useAtomRefresh(collectionsAtom);
  const create = useAtomSet(createCollectionAtom, { mode: "promise" });
  const rename = useAtomSet(renameCollectionAtom, { mode: "promise" });
  const remove = useAtomSet(deleteCollectionAtom, { mode: "promise" });
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = (work: Promise<unknown>) =>
    work.then(refresh).catch((e: unknown) => setError(errorMessage(e)));

  const list = AsyncResult.getOrElse(collections, () => [] as ReadonlyArray<Collection>);
  const open = list.find((c) => c.id === openId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border">
        <form
          className="flex gap-1.5 border-b border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() === "") return;
            void guard(create(name.trim()));
            setName("");
          }}
        >
          <input
            className={inputClass}
            aria-label="New collection"
            placeholder="new collection"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="icon-xs" variant="outline" aria-label="Create collection">
            <Plus />
          </Button>
        </form>
        {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
        <ul className="flex flex-col overflow-y-auto p-1">
          {list.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                className="min-w-0 flex-1 justify-start data-[active=true]:bg-accent"
                data-active={c.id === openId ? "true" : undefined}
                onClick={() => setOpenId(c.id)}
              >
                <span className="truncate">{c.name}</span>
                <span className="ml-auto font-mono text-2xs text-muted-foreground">{c.posts}</span>
              </Button>
              {c.builtIn ? null : (
                <>
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label="Rename"
                    onClick={() => {
                      const next = window.prompt("Rename collection", c.name);
                      if (next !== null && next.trim() !== "")
                        void guard(rename({ id: c.id, name: next.trim() }));
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost-destructive"
                    size="icon-xs"
                    aria-label="Delete"
                    onClick={() => {
                      if (window.confirm(`Delete "${c.name}"? Posts stay in the swipe file.`)) {
                        void guard(remove(c.id));
                        if (openId === c.id) setOpenId(null);
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {open === null ? (
          <Empty>Pick a collection. Staff picks fills itself from the daily picks.</Empty>
        ) : (
          <CollectionPosts collection={open} />
        )}
      </div>
    </div>
  );
}
