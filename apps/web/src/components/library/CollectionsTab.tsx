import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Collection, SavedPost, XPost } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Check, ChevronDown, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";

import { draggedPost, POST_TYPE } from "../../lib/drag";
import { fmtDay } from "../../lib/time";
import { cn } from "../../lib/utils";
import {
  addToCollectionAtom,
  collectionPagesAtom,
  collectionPostsAtom,
  collectionsAtom,
  createCollectionAtom,
  deleteCollectionAtom,
  deleteSavedAtom,
  removeFromCollectionAtom,
  renameCollectionAtom,
  savePostAtom,
  setNoteAtom,
  swipeFileAtom,
} from "../../state/library";
import { PageHeader } from "../PageHeader";
import { compactInputClass, inputClass } from "../ui/field";
import { Empty } from "../ui/layout";
import { Menu, MenuItem } from "../ui/menu";
import { DetailSplit } from "../ui/split";
import { toastAtom } from "../ui/toast";
import { xAction, xIconButton, xPill, xPillSm, xPillSolid } from "../x";
import { PostGrid } from "./PostCard";
import { InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton } from "./SaveButton";
import { ErrorLine, ShowMore, causeMessage, errorMessage } from "./shared";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The selected saved post: its note, more collections, remix, remove. Remove in a collection
 * takes it out of that one; in the swipe file it is Delete saved post, everywhere, after a confirm.
 */
function SavedInspector({
  saved,
  collection,
  onChange,
  onRemoved,
  onClose,
}: {
  readonly saved: SavedPost;
  readonly collection: Collection | undefined;
  readonly onChange: () => void;
  readonly onRemoved: () => void;
  readonly onClose: () => void;
}) {
  const setNote = useAtomSet(setNoteAtom, { mode: "promise" });
  const remove = useAtomSet(deleteSavedAtom, { mode: "promise" });
  const unlink = useAtomSet(removeFromCollectionAtom, { mode: "promise" });
  const [note, setNoteText] = useState(saved.note);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(errorMessage(e));
  return (
    <PostInspector
      post={saved.post}
      facts={[
        ["Saved", fmtDay(saved.savedAt)],
        ["Collections", String(saved.collectionIds.length)],
      ]}
      onClose={onClose}
    >
      <InspectorGroup title="Act">
        <div className="flex flex-wrap items-center gap-1.5">
          <SaveButton post={saved.post} saved />
          <RemixButton post={saved.post} />
          {/* Staff picks is read-only, as the service keeps it. */}
          {collection?.builtIn === true ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={cn(xAction, "ml-auto text-xs hover:text-error-foreground")}
                    onClick={() => {
                      if (
                        collection === undefined &&
                        !window.confirm(
                          "Delete this saved post? Its note goes with it, and it leaves every collection.",
                        )
                      )
                        return;
                      void (
                        collection === undefined
                          ? remove([saved.id])
                          : unlink({ collectionId: collection.id, savedId: saved.id })
                      ).then(onRemoved, fail);
                    }}
                  />
                }
              >
                <Trash2 /> {collection === undefined ? "Delete saved post" : "Remove"}
              </TooltipTrigger>
              <TooltipPopup>
                {collection === undefined
                  ? "Delete from the swipe file and every collection"
                  : `Take out of ${collection.name}; it stays in the swipe file`}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
      </InspectorGroup>
      <InspectorGroup title="Note">
        <textarea
          className={cn(inputClass, "min-h-20 resize-y leading-normal")}
          aria-label="Note"
          placeholder="Why you kept it"
          value={note}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => {
            if (note !== saved.note) void setNote({ id: saved.id, note }).then(onChange, fail);
          }}
        />
      </InspectorGroup>
      {error !== null ? <ErrorLine className="px-5 pt-3 pb-0">{error}</ErrorLine> : null}
    </PostInspector>
  );
}

/** Whether every, some or none of the checked posts are already in a collection. */
function FiledBox({ n, of }: { readonly n: number; readonly of: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[3px] border border-white/30 [&_svg]:size-3",
        n > 0 && "border-foreground bg-foreground text-background",
      )}
    >
      {n === 0 ? null : n === of ? <Check /> : <Minus />}
    </span>
  );
}

/** The checked cards' actions, pinned under the grid while any card is checked. */
function PickBar({
  picked,
  collection,
  onDone,
  onClear,
}: {
  readonly picked: readonly [SavedPost, ...Array<SavedPost>];
  readonly collection: Collection | undefined;
  readonly onDone: () => void;
  readonly onClear: () => void;
}) {
  const collections = useAtomValue(collectionsAtom);
  const refreshCollections = useAtomRefresh(collectionsAtom);
  const add = useAtomSet(addToCollectionAtom, { mode: "promise" });
  const create = useAtomSet(createCollectionAtom, { mode: "promise" });
  const remove = useAtomSet(deleteSavedAtom, { mode: "promise" });
  const setToast = useAtomSet(toastAtom);
  const [error, setError] = useState<string | null>(null);
  // Naming a new collection takes the menu's place in the bar until it is filed or dropped.
  const [naming, setNaming] = useState<string | null>(null);
  // Staff picks is read-only, and the open collection already holds them.
  const targets = AsyncResult.getOrElse(collections, (): ReadonlyArray<Collection> => []).filter(
    (c) => !c.builtIn && c.id !== collection?.id,
  );
  const n = picked.length;
  const [head, ...rest] = picked;
  const savedIds = [head.id, ...rest.map((s) => s.id)] as const;
  const fail = (e: unknown) => setError(errorMessage(e));
  const file = (target: Collection) => {
    setError(null);
    return add({ collectionId: target.id, savedIds }).then(({ added }) => {
      setToast({
        text:
          added === n
            ? `Added ${n} to ${target.name}`
            : `Added ${added} to ${target.name}, ${n - added} already there`,
      });
      setNaming(null);
      refreshCollections();
      onDone();
    }, fail);
  };
  const fileIntoNew = (name: string) => {
    setError(null);
    void create(name).then(file, fail);
  };
  const deleteAll = () => {
    if (
      !window.confirm(
        `Delete ${n} saved ${n === 1 ? "post" : "posts"}? Their notes go with them, and they leave every collection.`,
      )
    )
      return;
    setError(null);
    remove(savedIds).then(({ deleted }) => {
      setToast({ text: `Deleted ${deleted} saved ${deleted === 1 ? "post" : "posts"}` });
      refreshCollections();
      onDone();
    }, fail);
  };
  return (
    <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background px-6 py-2">
      <span className="font-mono text-xs tabular-nums">{n} selected</span>
      {naming !== null ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim() !== "") fileIntoNew(naming.trim());
          }}
        >
          <input
            // It opens from the menu row just picked, so typing the name follows at once.
            autoFocus
            aria-label="New collection name"
            placeholder="New collection"
            className={cn(compactInputClass, "w-44")}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNaming(null);
            }}
          />
          <button type="submit" className={cn(xPillSolid, xPillSm)} disabled={naming.trim() === ""}>
            Create and add {n}
          </button>
        </form>
      ) : (
        <Menu
          label="Collections"
          trigger={
            <button type="button" className={cn(xPillSolid, xPillSm, "[&_svg]:size-3.5")}>
              Add to collection <ChevronDown className="opacity-60" />
            </button>
          }
        >
          {targets.map((c) => {
            const inIt = picked.filter((s) => s.collectionIds.includes(c.id)).length;
            return (
              <MenuItem key={c.id} onClick={() => void file(c)}>
                <FiledBox n={inIt} of={n} />
                <span className="truncate">{c.name}</span>
                {inIt > 0 && inIt < n ? (
                  <span className="ml-auto font-mono text-2xs tabular-nums">
                    {inIt} of {n}
                  </span>
                ) : inIt === n ? (
                  <span className="sr-only">, all in it</span>
                ) : null}
              </MenuItem>
            );
          })}
          <MenuItem onClick={() => setNaming("")}>
            <Plus className="size-3.5" /> New collection
          </MenuItem>
        </Menu>
      )}
      {/* In a collection a post's own action is Remove; deleting everywhere stays a swipe file act. */}
      {collection === undefined ? (
        <button
          type="button"
          className="h-7 cursor-pointer px-2 text-xs text-muted-foreground transition-colors duration-150 hover:text-error-foreground"
          onClick={deleteAll}
        >
          Delete
        </button>
      ) : null}
      {error !== null ? (
        <span className="truncate text-xs text-error-foreground">{error}</span>
      ) : null}
      <button
        type="button"
        className="ml-auto h-7 cursor-pointer px-2 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}

/** Saved posts as cards, the selected one in the detail column. Collections and the swipe file share it. */
export function SavedPosts({
  result,
  collection,
  onChange,
  onMore,
  empty,
}: {
  readonly result: AsyncResult.AsyncResult<
    { readonly items: ReadonlyArray<SavedPost>; readonly total: number },
    unknown
  >;
  /** The collection listed; none is the swipe file. */
  readonly collection?: Collection;
  readonly onChange: () => void;
  /** Loads the next page. */
  readonly onMore: () => void;
  readonly empty: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // A removed post leaves at once, so the grid can hand focus to its neighbour before the refetch.
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const { items, total } = AsyncResult.getOrElse(result, () => ({
    items: [] as ReadonlyArray<SavedPost>,
    total: 0,
  }));
  const rows = items.filter((s) => !removed.has(s.id));
  const open = rows.find((s) => String(s.id) === selected);
  const pickedRows = rows.filter((s) => picked.has(String(s.id)));
  return (
    <DetailSplit
      closable
      label="Selected post"
      detailKey={selected}
      detail={
        open === undefined ? null : (
          <SavedInspector
            key={open.id}
            saved={open}
            collection={collection}
            onChange={onChange}
            onRemoved={() => {
              setRemoved(new Set(removed).add(open.id));
              setSelected(null);
              onChange();
            }}
            onClose={() => setSelected(null)}
          />
        )
      }
      list={AsyncResult.match(result, {
        onInitial: () => <Empty>Loading saved posts</Empty>,
        onFailure: (f) => <ErrorLine className="py-4">{causeMessage(f.cause)}</ErrorLine>,
        onSuccess: () =>
          rows.length === 0 ? (
            empty
          ) : (
            <>
              <PostGrid
                items={rows.map((s) => ({
                  key: String(s.id),
                  post: s.post,
                  tag: `saved ${fmtDay(s.savedAt)}`,
                  note: s.note,
                }))}
                selected={selected}
                onSelect={setSelected}
                actions={(item) => <RemixButton post={item.post} />}
                picked={picked}
                onPick={(key) => {
                  const next = new Set(picked);
                  if (!next.delete(key)) next.add(key);
                  setPicked(next);
                }}
              />
              <ShowMore
                shown={items.length}
                total={total}
                waiting={result.waiting}
                onMore={onMore}
                past={
                  collection === undefined
                    ? "Search to find the rest."
                    : "Search the swipe file to find the rest."
                }
              />
              {pickedRows[0] === undefined ? null : (
                <PickBar
                  picked={[pickedRows[0], ...pickedRows.slice(1)]}
                  collection={collection}
                  onDone={() => {
                    setPicked(new Set());
                    onChange();
                  }}
                  onClear={() => setPicked(new Set())}
                />
              )}
            </>
          ),
      })}
    />
  );
}

function CollectionPosts({ collection }: { readonly collection: Collection }) {
  const posts = useAtomValue(collectionPostsAtom(collection.id));
  const [pages, setPages] = useAtom(collectionPagesAtom(collection.id));
  const refresh = useAtomRefresh(collectionPostsAtom(collection.id));
  const refreshAll = useAtomRefresh(swipeFileAtom(""));
  const refreshCollections = useAtomRefresh(collectionsAtom);
  return (
    <SavedPosts
      result={posts}
      collection={collection}
      onChange={() => {
        refresh();
        refreshAll();
        refreshCollections();
      }}
      onMore={() => setPages(pages + 1)}
      empty={
        <Empty>
          {collection.builtIn
            ? "The daily picks land here."
            : `Nothing in ${collection.name} yet. Use Save on any post to add it.`}
        </Empty>
      }
    />
  );
}

/** One collection in the rail: open on click, rename inline, delete after a confirm, drop a card to file it. */
function CollectionRow({
  collection,
  active,
  onOpen,
  onRename,
  onDelete,
  onFile,
}: {
  readonly collection: Collection;
  readonly active: boolean;
  readonly onOpen: () => void;
  readonly onRename: (name: string) => void;
  readonly onDelete: () => void;
  readonly onFile: (post: XPost) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // Staff picks fills itself, so it takes no drop.
  const takesPost = collection.builtIn
    ? {}
    : {
        onDragOver: (event: DragEvent<HTMLButtonElement>) => {
          if (!event.dataTransfer.types.includes(POST_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          event.currentTarget.setAttribute("data-over", "");
        },
        onDragLeave: (event: DragEvent<HTMLButtonElement>) =>
          event.currentTarget.removeAttribute("data-over"),
        onDrop: (event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.currentTarget.removeAttribute("data-over");
          const post = draggedPost.current();
          if (post !== null) onFile(post);
        },
      };
  if (editing !== null)
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editing.trim() !== "" && editing.trim() !== collection.name)
              onRename(editing.trim());
            setEditing(null);
          }}
        >
          <input
            ref={(el) => el?.focus()}
            aria-label="Collection name"
            className={cn(compactInputClass, "w-full")}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        </form>
      </li>
    );
  return (
    <li className="group/row flex items-center">
      <button
        type="button"
        data-active={active}
        className="flex h-7 min-w-0 flex-1 cursor-pointer items-center rounded-[var(--control-radius)] px-2 text-left text-[13px] text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-white/[0.06] data-[active=true]:text-foreground data-over:ring-1 data-over:ring-inset data-over:ring-foreground"
        onClick={onOpen}
        {...takesPost}
      >
        <span className="truncate">{collection.name}</span>
        <span className="ml-auto pl-2 font-mono text-2xs text-muted-foreground tabular-nums">
          {collection.posts}
        </span>
      </button>
      {collection.builtIn ? null : (
        <span className="flex shrink-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:hover)]:opacity-0">
          <button
            type="button"
            aria-label={`Rename ${collection.name}`}
            className={cn(xIconButton, "size-6 [&_svg]:size-3.5")}
            onClick={() => setEditing(collection.name)}
          >
            <Pencil />
          </button>
          <button
            type="button"
            aria-label={`Delete ${collection.name}`}
            className={cn(xIconButton, "size-6 hover:text-error-foreground [&_svg]:size-3.5")}
            onClick={() => {
              if (window.confirm(`Delete "${collection.name}"? Its posts stay in the swipe file.`))
                onDelete();
            }}
          >
            <Trash2 />
          </button>
        </span>
      )}
    </li>
  );
}

export function CollectionsTab({ tabs }: { readonly tabs?: ReactNode }) {
  const collections = useAtomValue(collectionsAtom);
  const refresh = useAtomRefresh(collectionsAtom);
  const create = useAtomSet(createCollectionAtom, { mode: "promise" });
  const rename = useAtomSet(renameCollectionAtom, { mode: "promise" });
  const remove = useAtomSet(deleteCollectionAtom, { mode: "promise" });
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const refreshSwipe = useAtomRefresh(swipeFileAtom(""));
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = (work: Promise<unknown>) =>
    work.then(refresh).catch((e: unknown) => setError(errorMessage(e)));

  const list = AsyncResult.getOrElse(collections, (): ReadonlyArray<Collection> => []);
  const open = list.find((c) => c.id === openId) ?? list[0] ?? null;

  return (
    <>
      <PageHeader
        title="Saved"
        tabs={tabs}
        detail={open === null ? undefined : `${open.name} · ${open.posts} posts`}
        actions={
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() === "") return;
              void guard(create(name.trim()).then((c) => setOpenId(c.id)));
              setName("");
            }}
          >
            <input
              className={cn(compactInputClass, "w-40 @max-[44rem]:w-28")}
              aria-label="New collection"
              placeholder="New collection"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className={cn(xPill, xPillSm, "[&_svg]:size-3.5")}
              disabled={name.trim() === ""}
            >
              <Plus /> Create
            </button>
          </form>
        }
      />
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Collections"
          className="w-52 shrink-0 overflow-y-auto border-r border-border p-2 @max-[40rem]:w-40"
        >
          {AsyncResult.isFailure(collections) ? (
            <ErrorLine className="px-2">{causeMessage(collections.cause)}</ErrorLine>
          ) : (
            <ul className="flex flex-col gap-px">
              {list.map((c) => (
                <CollectionRow
                  key={c.id}
                  collection={c}
                  active={c.id === open?.id}
                  onOpen={() => setOpenId(c.id)}
                  onRename={(next) => void guard(rename({ id: c.id, name: next }))}
                  onDelete={() => {
                    void guard(remove(c.id));
                    if (openId === c.id) setOpenId(null);
                  }}
                  onFile={(post) => {
                    void guard(save({ post, collectionId: c.id }).then(refreshSwipe));
                    setOpenId(c.id);
                  }}
                />
              ))}
            </ul>
          )}
        </nav>
        {open === null ? (
          <div className="flex-1">
            <Empty>Name a collection above to start one.</Empty>
          </div>
        ) : (
          <CollectionPosts key={open.id} collection={open} />
        )}
      </div>
    </>
  );
}
