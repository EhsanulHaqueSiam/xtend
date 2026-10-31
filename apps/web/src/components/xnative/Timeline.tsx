import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EnginePost } from "@xtend/contracts";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { type StateSnapshot, Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { type AnySurface, at, engineAtom, showWaiting, updateEngine } from "../../state/engine";
import { xScrollMore } from "../../state/x";
import { Empty } from "../ui/layout";
import { PostRail } from "./PostRail";
import { useXScrollParent, XColumn } from "./XColumn";
import { Avatar, postUrl, XPostView } from "./XPostView";

/** How often a list may ask X for its next page; X's own scrolling pace, not faster. */
const MORE_EVERY_MS = 1500;

/** How long a screen waits for X's first answer before it says so and offers x.com itself. */
const QUIET_MS = 12_000;

/** Where each list was left (scroll and measured heights), so Back lands on the same post. */
const places = new Map<AnySurface, StateSnapshot>();

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Keys that press a post's own button, found by its label so the key and the click are one path. */
const KEY_BUTTONS: Readonly<Record<string, string>> = {
  l: "Like",
  t: "Repost",
  b: "Bookmark on X",
  s: "Save to Library",
};

/** Opens a post in Xtend's own post screen. */
export const useOpenPost = () => {
  const navigate = useNavigate();
  return (p: EnginePost) =>
    void navigate({ to: "/post/$id", params: { id: p.postId }, search: { h: p.author.handle } });
};

/** X's blue "Show N posts", with the faces of who is waiting. */
function NewPostsPill({
  waiting,
  onShow,
}: {
  readonly waiting: ReadonlyArray<EnginePost>;
  readonly onShow: () => void;
}) {
  if (waiting.length === 0) return null;
  return (
    <button
      type="button"
      className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-[#1d9bf0] px-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgb(29_155_240/0.3)] transition-transform duration-150 active:scale-[0.97]"
      onClick={onShow}
    >
      <span className="flex">
        {waiting.slice(0, 3).map((p, i) => (
          <span key={p.postId} className={i === 0 ? "" : "-ml-1.5"}>
            <span className="block rounded-full ring-2 ring-[#1d9bf0]">
              <Avatar url={p.avatarUrl} size={20} />
            </span>
          </span>
        ))}
      </span>
      Show {waiting.length} {waiting.length === 1 ? "post" : "posts"}
    </button>
  );
}

/** The virtualized list itself; it scrolls with the column's page, not on its own. */
function PostList({
  surface,
  keepPlace,
  posts,
  quoted,
  selected,
  setSelected,
  list,
  onOpen,
}: {
  readonly surface: AnySurface;
  readonly keepPlace: boolean;
  readonly posts: ReadonlyArray<EnginePost>;
  readonly quoted: (id: string | null) => EnginePost | undefined;
  readonly selected: number;
  readonly setSelected: (i: number) => void;
  readonly list: RefObject<VirtuosoHandle | null>;
  readonly onOpen: (p: EnginePost) => void;
}) {
  const scroller = useXScrollParent();
  const lastMore = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(trailing.current ?? undefined), []);
  // Virtuoso fires endReached once per list length, so a call inside the pause is kept for its end
  // rather than dropped; otherwise the feed would stall at its last post.
  const more = () => {
    const wait = lastMore.current + MORE_EVERY_MS - Date.now();
    if (wait > 0) {
      trailing.current ??= setTimeout(() => {
        trailing.current = null;
        more();
      }, wait);
      return;
    }
    lastMore.current = Date.now();
    void xScrollMore();
  };
  if (scroller === null) return null;
  return (
    <Virtuoso
      ref={list}
      customScrollParent={scroller}
      data={posts}
      {...(keepPlace && places.has(surface) ? { restoreStateFrom: places.get(surface)! } : {})}
      isScrolling={(moving) => {
        if (!moving && keepPlace) list.current?.getState((state) => places.set(surface, state));
      }}
      computeItemKey={(_, p) => p.postId}
      increaseViewportBy={800}
      endReached={more}
      itemContent={(index, p) => (
        <XPostView
          post={p}
          quoted={quoted(p.quotedId)}
          selected={index === selected}
          onOpen={onOpen}
          onHover={() => setSelected(index)}
        />
      )}
    />
  );
}

/**
 * A native X list in X's own column: the surface's posts in X's order, virtualized. Reaching the
 * end asks X's own page for more; newer posts wait behind a pill. The rail shows the post under
 * the pointer or the keyboard. J/K move, Enter opens, L like, T repost, B bookmark, S save,
 * O opens on x.com.
 */
export function Timeline({
  surface,
  header,
  top,
  empty,
  keepPlace = false,
  onReopen,
}: {
  readonly surface: AnySurface;
  readonly header: ReactNode;
  /** Back returns to the same post; for lists that persist in the store, not ones reloaded on open. */
  readonly keepPlace?: boolean;
  /** Sits above the list inside the column, as Home's composer does. */
  readonly top?: ReactNode;
  readonly empty: ReactNode;
  readonly onReopen: () => void;
}) {
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const open = useOpenPost();
  const list = useRef<VirtuosoHandle>(null);
  const [selected, setSelected] = useState(0);
  const posts = at(engine.lists, surface).flatMap((id) => engine.posts.get(id) ?? []);
  const waiting = at(engine.waiting, surface).flatMap((id) => engine.posts.get(id) ?? []);
  const current = posts[Math.min(selected, posts.length - 1)];
  const quoted = (id: string | null) => (id === null ? undefined : engine.posts.get(id));
  const navigate = useNavigate();
  // Which wait went quiet: a new surface or a list that empties again starts a fresh wait.
  const waitKey = `${surface}:${posts.length === 0}`;
  const [quietKey, setQuietKey] = useState<string | null>(null);
  const quiet = quietKey === waitKey;
  const [, setMinute] = useState(0);
  // Ages ("4m") move on while the list sits open; one re-render a minute is enough.
  useEffect(() => {
    const timer = setInterval(() => setMinute((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  // X has not answered for a while: say so, instead of loading forever.
  const empty0 = posts.length === 0;
  useEffect(() => {
    if (!empty0) return;
    const timer = setTimeout(() => setQuietKey(waitKey), QUIET_MS);
    return () => clearTimeout(timer);
  }, [empty0, waitKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      const label = KEY_BUTTONS[event.key];
      if (step !== 0) {
        const next = Math.max(0, Math.min(posts.length - 1, selected + step));
        setSelected(next);
        list.current?.scrollIntoView({ index: next, behavior: "auto" });
      } else if (current === undefined) return;
      else if (event.key === "Enter" || event.key === "r") open(current);
      else if (event.key === "o") window.desktopBridge?.openExternal(postUrl(current));
      else if (label !== undefined)
        document
          .querySelector<HTMLButtonElement>(
            `[data-post="${current.postId}"] button[aria-label="${label}"]`,
          )
          ?.click();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, open, posts.length, selected]);

  return (
    <XColumn
      header={header}
      float={
        <NewPostsPill
          waiting={waiting}
          onShow={() => {
            setEngine(updateEngine((s) => showWaiting(s, surface)));
            setSelected(0);
            list.current?.scrollToIndex({ index: 0 });
          }}
        />
      }
      rail={<PostRail post={current} seen={engine.posts.values()} onReply={open} />}
    >
      {top}
      {posts.length === 0 ? (
        <Empty
          action={
            quiet ? (
              <span className="flex gap-2">
                <button
                  type="button"
                  className="h-8 cursor-pointer rounded-full bg-foreground px-3.5 text-[13px] font-bold text-background"
                  onClick={onReopen}
                >
                  Load again
                </button>
                <button
                  type="button"
                  className="h-8 cursor-pointer rounded-full border border-white/[0.18] px-3.5 text-[13px] font-bold hover:bg-white/[0.06]"
                  onClick={() => void navigate({ to: "/x" })}
                >
                  Show x.com here
                </button>
              </span>
            ) : undefined
          }
        >
          {quiet ? "X has not sent this yet. It may be signed out or slow." : empty}
        </Empty>
      ) : (
        <PostList
          surface={surface}
          keepPlace={keepPlace}
          posts={posts}
          quoted={quoted}
          selected={selected}
          setSelected={setSelected}
          list={list}
          onOpen={open}
        />
      )}
    </XColumn>
  );
}
