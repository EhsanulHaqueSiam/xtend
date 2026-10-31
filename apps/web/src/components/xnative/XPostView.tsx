import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { EngineMedia, EnginePost } from "@xtend/contracts";
import { BadgeCheck, Bookmark, Heart, MessageCircle, Quote, Repeat2 } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { settingsAtom } from "../../state/settings";
import { type XAction, xActInPlace, xNavigate } from "../../state/x";
import { fmt } from "../analyze/ui";
import { ago } from "../engage/triage";
import { useDropPost } from "../shell/drops";
import { toastAtom } from "../ui/toast";

export const postUrl = (p: EnginePost) => `https://x.com/${p.author.handle}/status/${p.postId}`;

/** X ends a post with a t.co link to its own media or quote, which X itself never shows. */
const shownText = (p: EnginePost) =>
  p.media.length > 0 || p.quotedId !== null
    ? p.text.replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, "")
    : p.text;

/** Photos in X's grid, a video in Xtend's own player (fullscreen, picture in picture, speed), a GIF looping muted. */
function Media({
  media,
  small = false,
}: {
  readonly media: ReadonlyArray<EngineMedia>;
  readonly small?: boolean;
}) {
  if (media.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-2 grid gap-0.5 overflow-hidden rounded-xl border border-border",
        media.length > 1 && "grid-cols-2",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {media.map((m) =>
        m.kind === "photo" || m.videoUrl === null ? (
          <img
            key={m.url}
            src={m.url}
            alt=""
            loading="lazy"
            className={cn(
              "w-full bg-white/[0.03] object-cover",
              small ? "max-h-56" : "max-h-[420px]",
            )}
          />
        ) : (
          <video
            key={m.url}
            src={m.videoUrl}
            poster={m.url}
            controls={m.kind === "video"}
            autoPlay={m.kind === "gif"}
            loop={m.kind === "gif"}
            muted={m.kind === "gif"}
            playsInline
            preload="metadata"
            className={cn("w-full bg-black", small ? "max-h-56" : "max-h-[480px]")}
          />
        ),
      )}
    </div>
  );
}

/**
 * One post as Xtend draws it from the engine. `quoted` is the post it quotes, when the engine has
 * it. `onReopen` puts the engine back on this screen's page after an action took it elsewhere.
 */
export function XPostView({
  post,
  quoted,
  selected = false,
  focal = false,
  onOpen,
  onReopen,
}: {
  readonly post: EnginePost;
  readonly quoted?: EnginePost | undefined;
  readonly selected?: boolean;
  readonly focal?: boolean;
  readonly onOpen?: ((post: EnginePost) => void) | undefined;
  readonly onReopen?: (() => void) | undefined;
}) {
  const setToast = useAtomSet(toastAtom);
  const drop = useDropPost();
  const navigate = useNavigate();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  const [done, setDone] = useState<ReadonlySet<XAction>>(new Set());
  const has = (a: XAction) => done.has(a);
  /**
   * X's own button for the user's click: on the engine page where the post sits, so the list
   * keeps feeding; only when it is not there, on the post's own page, and then back.
   */
  const act = async (action: XAction) => {
    if (done.has(action)) return;
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    setDone((d) => new Set(d).add(action));
    let ok = await xActInPlace(post.postId, action);
    if (!ok) {
      await xNavigate(postUrl(post));
      ok = await xActInPlace(post.postId, action);
      onReopen?.();
    }
    if (ok) return;
    setDone((d) => new Set([...d].filter((a) => a !== action)));
    setToast({ text: "X did not take that. Try again in a moment." });
  };
  return (
    <article
      data-post={post.postId}
      data-selected={selected || undefined}
      className={cn(
        "grid grid-cols-[36px_minmax(0,1fr)] gap-3 border-b border-border px-5 py-3.5 transition-colors duration-150",
        onOpen !== undefined && "cursor-pointer hover:bg-white/[0.02]",
        selected && "bg-white/[0.04] shadow-[inset_2px_0_0_var(--foreground)]",
      )}
      onClick={() => onOpen?.(post)}
    >
      {post.avatarUrl === null ? (
        <span className="size-9 rounded-full bg-white/[0.06]" />
      ) : (
        <img src={post.avatarUrl} alt="" className="size-9 rounded-full" loading="lazy" />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1.5 text-[13px]">
          <button
            type="button"
            className="cursor-pointer truncate font-semibold hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              void navigate({ to: "/u/$handle", params: { handle: post.author.handle } });
            }}
          >
            {post.author.name}
          </button>
          {post.author.verified ? (
            <BadgeCheck className="size-3.5 shrink-0 self-center text-muted-foreground" />
          ) : null}
          <span className="truncate text-muted-foreground">@{post.author.handle}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            {ago(post.createdAt)}
          </span>
        </div>
        <p
          className={cn(
            "mt-0.5 break-words whitespace-pre-wrap text-foreground/95",
            focal ? "text-[16px] leading-relaxed" : "text-[14px] leading-snug",
          )}
        >
          {shownText(post)}
        </p>
        <Media media={post.media} />
        {quoted === undefined ? null : (
          <div
            className="mt-2 rounded-xl border border-border px-3 py-2 text-[13px]"
            onClick={(e) => {
              e.stopPropagation();
              onOpen?.(quoted);
            }}
          >
            <span className="font-semibold">{quoted.author.name}</span>{" "}
            <span className="text-muted-foreground">@{quoted.author.handle}</span>
            <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap">{shownText(quoted)}</p>
            <Media media={quoted.media} small />
          </div>
        )}
        <div
          className="mt-2 flex items-center gap-5 font-mono text-2xs text-muted-foreground tabular-nums"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Reply"
            className="flex cursor-pointer items-center gap-1.5 hover:text-foreground"
            onClick={() => onOpen?.(post)}
          >
            <MessageCircle className="size-3.5" />
            {fmt(post.metrics.replies)}
          </button>
          <button
            type="button"
            aria-label="Repost"
            aria-pressed={has("retweet")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 hover:text-foreground",
              has("retweet") && "text-success-foreground",
            )}
            onClick={() => void act("retweet")}
          >
            <Repeat2 className="size-3.5" />
            {fmt(post.metrics.reposts + (has("retweet") ? 1 : 0))}
          </button>
          <button
            type="button"
            aria-label="Like"
            aria-pressed={has("like")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 hover:text-foreground",
              has("like") && "text-error-foreground",
            )}
            onClick={() => void act("like")}
          >
            <Heart className={cn("size-3.5", has("like") && "fill-current")} />
            {fmt(post.metrics.likes + (has("like") ? 1 : 0))}
          </button>
          <button
            type="button"
            aria-label="Quote"
            className="flex cursor-pointer items-center gap-1.5 hover:text-foreground"
            onClick={() =>
              void navigate({ href: `/compose?quote=${encodeURIComponent(postUrl(post))}` })
            }
          >
            <Quote className="size-3.5" />
          </button>
          <span>{fmt(post.metrics.views)} views</span>
          <button
            type="button"
            aria-label="Bookmark on X"
            aria-pressed={has("bookmark")}
            className={cn(
              "ml-auto cursor-pointer hover:text-foreground",
              has("bookmark") && "text-foreground",
            )}
            onClick={() => void act("bookmark")}
          >
            <Bookmark className={cn("size-3.5", has("bookmark") && "fill-current")} />
          </button>
          <button
            type="button"
            aria-label="Save to Library"
            className="flex cursor-pointer items-center gap-1.5 hover:text-foreground"
            onClick={() =>
              drop("/library", {
                postId: post.postId,
                handle: post.author.handle,
                url: postUrl(post),
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </article>
  );
}
