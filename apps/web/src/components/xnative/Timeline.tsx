import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnginePost } from "@xtend/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { engineAtom, showWaiting, type Surface, updateEngine } from "../../state/engine";
import { xScrollMore } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Empty } from "../ui/layout";
import { XPostView } from "./XPostView";

/** How often a list may ask X for its next page; X's own scrolling pace, not faster. */
const MORE_EVERY_MS = 1500;

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Opens a post in Xtend's own post screen. */
export const useOpenPost = () => {
  const navigate = useNavigate();
  return (p: EnginePost) =>
    void navigate({ to: "/post/$id", params: { id: p.postId }, search: { h: p.author.handle } });
};

/** What Xtend knows about the selected post's author, beside the list. */
function AuthorPanel({ post }: { readonly post: EnginePost | undefined }) {
  const navigate = useNavigate();
  if (post === undefined) return null;
  const a = post.author;
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3 text-[13px]">
      <p className="font-semibold">{a.name}</p>
      <p className="text-xs text-muted-foreground">@{a.handle}</p>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-xs">
        {a.followers === null ? null : (
          <>
            <dt className="text-muted-foreground">Followers</dt>
            <dd className="font-mono">{fmt(a.followers)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">This post</dt>
        <dd className="font-mono">{fmt(post.metrics.views)} views</dd>
      </dl>
      <button
        type="button"
        className="mt-3 cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => void navigate({ href: `/scores?tab=report&handle=${a.handle}` })}
      >
        Score report
      </button>
    </section>
  );
}

/**
 * A native X list: the surface's posts in X's order, virtualized. Reaching the end asks X's own
 * page for more; newer posts wait behind a pill. J/K select, Enter opens, L likes, S saves.
 */
export function Timeline({
  surface,
  empty,
  onReopen,
}: {
  readonly surface: Surface;
  readonly empty: ReactNode;
  readonly onReopen: () => void;
}) {
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const open = useOpenPost();
  const list = useRef<VirtuosoHandle>(null);
  const lastMore = useRef(0);
  const [selected, setSelected] = useState(0);
  const ids = engine.lists[surface];
  const waiting = engine.waiting[surface].length;
  const posts = ids.flatMap((id) => engine.posts.get(id) ?? []);
  const current = posts[Math.min(selected, posts.length - 1)];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (step !== 0) {
        const next = Math.max(0, Math.min(posts.length - 1, selected + step));
        setSelected(next);
        list.current?.scrollIntoView({ index: next, behavior: "auto" });
      } else if (event.key === "Enter" && current !== undefined) open(current);
      else if (event.key === "l" || event.key === "s") {
        const label = event.key === "l" ? "Like" : "Save to Library";
        document
          .querySelector<HTMLButtonElement>(
            `[data-post="${current?.postId}"] button[aria-label="${label}"]`,
          )
          ?.click();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, open, posts.length, selected]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[1100px]:grid-cols-1">
      <div className="relative min-h-0 border-r border-border">
        {waiting > 0 ? (
          <button
            type="button"
            className="absolute top-3 left-1/2 z-10 -translate-x-1/2 cursor-pointer rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
            onClick={() => {
              setEngine(updateEngine((s) => showWaiting(s, surface)));
              setSelected(0);
              list.current?.scrollToIndex({ index: 0 });
            }}
          >
            ↑ {waiting} new {waiting === 1 ? "post" : "posts"}
          </button>
        ) : null}
        {posts.length === 0 ? (
          <Empty>{empty}</Empty>
        ) : (
          <Virtuoso
            ref={list}
            data={posts}
            computeItemKey={(_, p) => p.postId}
            increaseViewportBy={600}
            endReached={() => {
              if (Date.now() - lastMore.current < MORE_EVERY_MS) return;
              lastMore.current = Date.now();
              void xScrollMore();
            }}
            itemContent={(index, p) => (
              <XPostView
                post={p}
                quoted={p.quotedId === null ? undefined : engine.posts.get(p.quotedId)}
                selected={index === selected}
                onOpen={open}
                onReopen={onReopen}
              />
            )}
          />
        )}
      </div>
      <aside className="flex flex-col gap-3 p-4 max-[1100px]:hidden">
        <AuthorPanel post={current} />
        <section className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <p className="mb-2 font-semibold text-foreground">Keys</p>
          <p>J / K select · Enter open · L like · S save</p>
        </section>
      </aside>
    </div>
  );
}
