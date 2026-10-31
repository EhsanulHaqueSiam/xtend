import { useAtomSet } from "@effect/atom-react";
import type { EngineMedia, EnginePost } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { BadgeCheck, Bookmark, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { likeAtom } from "../../state/engage";
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
  const like = useAtomSet(likeAtom(post.postId), { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  const drop = useDropPost();
  const [liked, setLiked] = useState(false);
  const likeNow = async () => {
    if (liked) return;
    setLiked(true);
    const exit = await like();
    // X's own button did it, on the post's page; the screen's list stays as it was.
    onReopen?.();
    if (Exit.isFailure(exit)) {
      setLiked(false);
      setToast({ text: "X did not take the like. Try again in a moment." });
    }
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
          <span className="truncate font-semibold">{post.author.name}</span>
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
          <span className="flex items-center gap-1.5">
            <Repeat2 className="size-3.5" />
            {fmt(post.metrics.reposts)}
          </span>
          <button
            type="button"
            aria-label={liked ? "Liked" : "Like"}
            aria-pressed={liked}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 hover:text-foreground",
              liked && "text-error-foreground",
            )}
            onClick={() => void likeNow()}
          >
            <Heart className={cn("size-3.5", liked && "fill-current")} />
            {fmt(post.metrics.likes + (liked ? 1 : 0))}
          </button>
          <span>{fmt(post.metrics.views)} views</span>
          <button
            type="button"
            aria-label="Save to Library"
            className="ml-auto flex cursor-pointer items-center gap-1.5 hover:text-foreground"
            onClick={() =>
              drop("/library", {
                postId: post.postId,
                handle: post.author.handle,
                url: postUrl(post),
              })
            }
          >
            <Bookmark className="size-3.5" />
            Save
          </button>
        </div>
      </div>
    </article>
  );
}
