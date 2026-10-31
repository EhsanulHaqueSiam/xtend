import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { EngineMedia, EnginePost, EngineUser } from "@xtend/contracts";
import {
  BarChart2,
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import { settingsAtom } from "../../state/settings";
import { xAct } from "../../state/x";
import { fmt } from "../analyze/ui";
import { useDropPost } from "../shell/drops";
import { Menu, MenuItem } from "../ui/menu";
import { toastAtom } from "../ui/toast";
import { FollowButton } from "./FollowButton";
import { HoverCard } from "./HoverCard";
import { viewerAtom } from "./MediaViewer";
import { ContextLine, LinkCard, Note, Poll } from "./PostParts";
import { RichText } from "./RichText";
import { avatar96, engagement, viewsPerHour, xAge, xStamp } from "./format";

export const postUrl = (p: EnginePost) => `https://x.com/${p.author.handle}/status/${p.postId}`;

/** The three buttons a post's own state comes with, and the button that takes each back. */
type Press = "like" | "retweet" | "bookmark";
const UNDO = { like: "unlike", retweet: "unretweet", bookmark: "removeBookmark" } as const;

/** X shows a long post's first 280 characters in a list, then "Show more". */
const SHOWN_IN_LIST = 280;
const clampText = (text: string) => {
  if (text.length <= SHOWN_IN_LIST) return null;
  const cut = text.slice(0, SHOWN_IN_LIST);
  const space = cut.lastIndexOf(" ");
  return `${space > 200 ? cut.slice(0, space) : cut}…`;
};

/** X's gray for handles, times and counts; Xtend's own muted grey stays for Xtend's numbers. */
const X_GRAY = "text-[#71767b]";

/** X's blue badge with a white check. */
/** X's check: blue, gold for a business, grey for a government account. */
export function Verified({
  className,
  type = null,
}: {
  readonly className?: string;
  readonly type?: string | null;
}) {
  return (
    <svg
      viewBox="0 0 22 22"
      aria-label="Verified account"
      className={cn("size-[18px] shrink-0", className)}
    >
      <path
        fill={type === "Business" ? "#e2b719" : type === "Government" ? "#829aab" : "#1d9bf0"}
        d="M20.4 11c0-1.4-.8-2.6-2-3.2.4-1.3.1-2.8-.9-3.7-1-1-2.4-1.3-3.7-.9C13.2 2 12 1.2 10.6 1.2S8 2 7.4 3.2C6.1 2.8 4.6 3.1 3.7 4.1c-1 1-1.3 2.4-.9 3.7C1.6 8.4.8 9.6.8 11s.8 2.6 2 3.2c-.4 1.3-.1 2.8.9 3.7 1 1 2.4 1.3 3.7.9.6 1.2 1.8 2 3.2 2s2.6-.8 3.2-2c1.3.4 2.8.1 3.7-.9 1-1 1.3-2.4.9-3.7 1.2-.6 2-1.8 2-3.2z"
      />
      <path fill="#fff" d="M9.6 14.8 6 11.2l1.4-1.4 2.2 2.2 5-5L16 8.4z" />
    </svg>
  );
}

/** The organisation badge X draws after an affiliate's name. */
export function Affiliate({ user }: { readonly user: EngineUser | undefined }) {
  if (user?.affiliate?.badgeUrl == null) return null;
  return (
    <img
      src={user.affiliate.badgeUrl}
      alt={user.affiliate.name}
      title={user.affiliate.name}
      className="size-4 shrink-0 rounded-[3px] border border-white/20"
    />
  );
}

/** A round avatar from X's image, or a quiet circle until it is known. */
export function Avatar({
  url,
  size,
  square = false,
}: {
  readonly url: string | null;
  readonly size: number;
  /** X draws an organisation's avatar as a rounded square. */
  readonly square?: boolean;
}) {
  return url === null ? (
    <span
      className={cn("block shrink-0 bg-white/[0.08]", square ? "rounded-[22%]" : "rounded-full")}
      style={{ width: size, height: size }}
    />
  ) : (
    <img
      src={avatar96(url)}
      alt=""
      loading="lazy"
      className={cn(
        "shrink-0 bg-white/[0.08] object-cover",
        square ? "rounded-[22%]" : "rounded-full",
      )}
      style={{ width: size, height: size }}
    />
  );
}

/** One photo, video or GIF in X's grid; a video plays in Xtend's player (fullscreen, picture in picture, speed). */
/** "0:47", X's length badge on a video. */
const duration = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function MediaItem({
  m,
  fill,
  still,
  onView,
}: {
  readonly m: EngineMedia;
  readonly fill: boolean;
  /** A quote's media: a still with a play mark and its length, as X draws it; a click opens the quote. */
  readonly still: boolean;
  readonly onView: () => void;
}) {
  const cls = cn("block w-full cursor-zoom-in bg-white/[0.04] object-cover", fill && "h-full");
  if (m.kind === "photo" || m.videoUrl === null)
    return (
      <span className={cn("relative block", fill && "h-full")}>
        <img
          src={m.url}
          alt={m.altText ?? ""}
          loading="lazy"
          className={cls}
          // Inside a quote, a photo opens the quoted post, not the viewer.
          onClick={still ? undefined : onView}
        />
        {m.altText === null ? null : (
          <span
            title={m.altText}
            className="absolute bottom-2 left-2 rounded bg-black/75 px-1 text-[12px] font-bold"
          >
            ALT
          </span>
        )}
      </span>
    );
  if (still)
    return (
      <span className={cn("relative block bg-black", fill && "h-full")}>
        <img src={m.url} alt={m.altText ?? ""} loading="lazy" className={cls} />
        {m.kind === "gif" ? null : (
          <span className="absolute inset-0 m-auto grid size-12 place-items-center rounded-full bg-[#1d9bf0]/90">
            <svg viewBox="0 0 24 24" className="ml-0.5 size-5 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1 font-mono text-[12px] empty:hidden">
          {m.kind === "gif" ? "GIF" : m.durationMs === null ? "" : duration(m.durationMs)}
        </span>
      </span>
    );
  return (
    <span className={cn("relative block bg-black", fill && "h-full")}>
      <video
        src={m.videoUrl}
        poster={m.url}
        controls={m.kind === "video"}
        autoPlay={m.kind === "gif"}
        loop={m.kind === "gif"}
        muted={m.kind === "gif"}
        playsInline
        preload="metadata"
        className={cn("block w-full bg-black object-cover", fill && "h-full")}
      />
      {m.kind === "gif" ? (
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1 text-[11px] font-bold">
          GIF
        </span>
      ) : null}
    </span>
  );
}

/**
 * X's media grid: one item at its own shape, as tall as 510px and no wider than the column (so a
 * portrait shot stands narrow, as on X), two side by side, three with the first tall, four in a
 * square grid. A group sits at 16:9.
 */
function Media({
  media,
  still = false,
}: {
  readonly media: ReadonlyArray<EngineMedia>;
  readonly still?: boolean;
}) {
  const view = useAtomSet(viewerAtom);
  if (media.length === 0) return null;
  const one = media.length === 1 ? media[0]! : null;
  const shape = one !== null && one.width > 0 && one.height > 0 ? one.width / one.height : null;
  return (
    <div
      data-x="media"
      className={cn(
        "overflow-hidden rounded-2xl border border-white/[0.12]",
        one === null && "grid aspect-video grid-cols-2 gap-0.5",
        media.length > 2 && "grid-rows-2",
      )}
      style={
        shape === null ? undefined : { aspectRatio: shape, width: `min(100%, ${510 * shape}px)` }
      }
      // A quote's stills open the quoted post, so only live media keeps the click.
      onClick={still ? undefined : (e) => e.stopPropagation()}
    >
      {media.map((m, i) => (
        <span
          key={m.url}
          className={cn("block h-full min-h-0", media.length === 3 && i === 0 && "row-span-2")}
        >
          <MediaItem
            m={m}
            fill
            still={still}
            onView={() =>
              view({ media, index: media.filter((x) => x.kind === "photo").indexOf(m) })
            }
          />
        </span>
      ))}
    </div>
  );
}

/** The post a post quotes, inside a hairline box. */
function QuoteBox({
  quoted,
  onOpen,
}: {
  readonly quoted: EnginePost;
  readonly onOpen: ((post: EnginePost) => void) | undefined;
}) {
  const qAuthor = useAtomValue(engineAtom).users.get(quoted.author.userId);
  return (
    <div
      data-x="quote"
      className="cursor-pointer overflow-hidden rounded-2xl border border-white/[0.12] transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(quoted);
      }}
    >
      <div className="flex min-w-0 items-center gap-1 px-3 pt-3 text-[15px]">
        <Avatar url={quoted.avatarUrl} size={20} square={qAuthor?.avatarShape === "Square"} />
        <span className="ml-1 truncate font-bold">{quoted.author.name}</span>
        {quoted.author.verified ? (
          <Verified className="size-4" type={qAuthor?.verifiedType ?? null} />
        ) : null}
        <Affiliate user={qAuthor} />
        <span className={cn("truncate", X_GRAY)}>
          @{quoted.author.handle} · {xAge(quoted.createdAt)}
        </span>
      </div>
      <p className="line-clamp-6 px-3 pt-0.5 pb-3 text-[15px] leading-5 break-words whitespace-pre-wrap">
        <RichText text={quoted.text} entities={quoted.entities} />
      </p>
      {quoted.media.length === 0 ? null : (
        // X insets a quote's media inside the box and centres a tall shot.
        <div className="px-3 pb-3 [&>div]:mx-auto">
          <Media media={quoted.media} still />
        </div>
      )}
    </div>
  );
}

/** What X draws under a post's text besides media: its link card, poll and Community Note. */
function Extras({ post }: { readonly post: EnginePost }) {
  return (
    <>
      {post.card === null ? null : <LinkCard card={post.card} />}
      {post.poll === null ? null : <Poll poll={post.poll} />}
      {post.note === null ? null : <Note note={post.note} />}
    </>
  );
}

/** "Replying to @a @b", the handles X moved out of the text. */
function ReplyingTo({ handles }: { readonly handles: ReadonlyArray<string> }) {
  if (handles.length === 0) return null;
  return (
    <p className="text-[15px] leading-5 text-[#71767b]">
      Replying to <RichText text={handles.map((h) => `@${h}`).join(" ")} />
    </p>
  );
}

/** One button in X's action row: X's grey, its own colour on hover and when pressed. */
function Action({
  label,
  pressed,
  tone,
  count,
  onClick,
  children,
}: {
  readonly label: string;
  readonly pressed?: boolean | undefined;
  readonly tone: "blue" | "green" | "pink";
  readonly count?: string | undefined;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const hover = {
    blue: "hover:text-[#1d9bf0] [&:hover>span:first-child]:bg-[#1d9bf0]/10",
    green: "hover:text-[#00ba7c] [&:hover>span:first-child]:bg-[#00ba7c]/10",
    pink: "hover:text-[#f91880] [&:hover>span:first-child]:bg-[#f91880]/10",
  }[tone];
  const on = { blue: "text-[#1d9bf0]", green: "text-[#00ba7c]", pink: "text-[#f91880]" }[tone];
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "group/act flex cursor-pointer items-center text-[13px] tabular-nums transition-colors duration-150",
        X_GRAY,
        hover,
        pressed === true && on,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <span className="-m-2 grid size-[34px] place-items-center rounded-full transition-colors duration-150">
        {children}
      </span>
      {count === undefined ? null : <span className="pl-1">{count}</span>}
    </button>
  );
}

/** Xtend's line under a post: how it is doing, in mono, out of X's way. */
function XtendLine({ post }: { readonly post: EnginePost }) {
  const er = engagement(post);
  const vph = viewsPerHour(post);
  if (er === null && vph === null) return null;
  return (
    <p
      data-x="metrics"
      className="flex gap-3.5 font-mono text-xs text-muted-foreground tabular-nums"
    >
      {er === null ? null : (
        <span>
          <b className="font-medium text-foreground/85">{(er * 100).toFixed(1)}%</b> ER
        </span>
      )}
      {vph === null ? null : (
        <span>
          <b className="font-medium text-foreground/85">{fmt(Math.round(vph))}</b>/h
        </span>
      )}
    </p>
  );
}

/**
 * One post as Xtend draws it from the engine, in X's shape. `quoted` is the post it quotes, when
 * the engine has it. `focal` is the post a post screen is about: larger text, its full timestamp.
 */
export function XPostView({
  post,
  quoted,
  selected = false,
  focal = false,
  threaded = false,
  onOpen,
  onHover,
}: {
  readonly post: EnginePost;
  readonly quoted?: EnginePost | undefined;
  readonly selected?: boolean;
  readonly focal?: boolean;
  /** A line runs down from the avatar to the next post: this one is answered under it. */
  readonly threaded?: boolean;
  readonly onOpen?: ((post: EnginePost) => void) | undefined;
  readonly onHover?: (() => void) | undefined;
}) {
  const setToast = useAtomSet(toastAtom);
  const drop = useDropPost();
  const navigate = useNavigate();
  const settings = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null);
  // The author as X described them (badge colour, organisation shape, affiliate), when seen.
  const author = useAtomValue(engineAtom).users.get(post.author.userId);
  const square = author?.avatarShape === "Square";
  /**
   * What the user asked for here, per button; X's own state wins again once it agrees (a fresh
   * capture after the press), so the two never fight.
   */
  const [want, setWant] = useState<Partial<Record<Press, boolean>>>({});
  const [busy, setBusy] = useState<ReadonlySet<Press>>(new Set());
  const was = { like: post.liked, retweet: post.reposted, bookmark: post.bookmarked };
  // Once X's capture agrees with a press, X's state is the truth again (it may change on x.com).
  const agreed = (Object.keys(want) as Array<Press>).filter((p) => want[p] === was[p]);
  if (agreed.length > 0)
    setWant((w) =>
      Object.fromEntries(Object.entries(w).filter(([p]) => !agreed.includes(p as Press))),
    );
  const has = (p: Press) => want[p] ?? was[p];
  /** X's count, moved by the user's own press until X's capture catches up. */
  const shift = (p: Press) => (has(p) === was[p] ? 0 : has(p) ? 1 : -1);
  /**
   * X's own button for the user's click (or the one that takes it back): in place on the engine
   * page where the post sits, or on the post's own page through X's router and back.
   */
  const act = async (press: Press) => {
    if (busy.has(press)) return;
    if (settings !== null && !settings.sessionPostingEnabled)
      return setToast({ text: "Session actions are off in Settings, X session." });
    const target = !has(press);
    setWant((w) => ({ ...w, [press]: target }));
    setBusy((b) => new Set(b).add(press));
    const ok = await xAct(
      { postId: post.postId, handle: post.author.handle },
      target ? press : UNDO[press],
    );
    setBusy((b) => new Set([...b].filter((x) => x !== press)));
    if (ok) return;
    setWant((w) => ({ ...w, [press]: undefined }));
    setToast({ text: "X did not take that. Try again in a moment." });
  };
  const openProfile = () =>
    void navigate({ to: "/u/$handle", params: { handle: post.author.handle } });
  const save = () =>
    drop("/library", { postId: post.postId, handle: post.author.handle, url: postUrl(post) });
  const copyLink = () =>
    void navigator.clipboard.writeText(postUrl(post)).then(() => setToast({ text: "Link copied" }));
  const m = post.metrics;

  const name = (
    <span className="flex min-w-0 items-center gap-1">
      <HoverCard author={post.author} avatarUrl={post.avatarUrl}>
        <button
          type="button"
          className="cursor-pointer truncate font-bold hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            openProfile();
          }}
        >
          {post.author.name}
        </button>
      </HoverCard>
      {post.author.verified ? <Verified type={author?.verifiedType ?? null} /> : null}
      <Affiliate user={author} />
    </span>
  );
  const menu = (
    <Menu
      label="Post actions"
      align="end"
      trigger={
        <button
          type="button"
          aria-label="More"
          className={cn(
            "-m-2 ml-auto grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0]",
            X_GRAY,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
      }
    >
      <MenuItem onClick={copyLink}>Copy link</MenuItem>
      <MenuItem onClick={save}>Save to Library</MenuItem>
      <MenuItem
        onClick={() =>
          void navigate({ href: `/compose?quote=${encodeURIComponent(postUrl(post))}` })
        }
      >
        Quote in Compose
      </MenuItem>
      <MenuItem
        onClick={() => void navigate({ href: `/scores?tab=report&handle=${post.author.handle}` })}
      >
        Score @{post.author.handle}
      </MenuItem>
      <MenuItem onClick={() => window.desktopBridge?.openExternal(postUrl(post))}>
        Open in browser
      </MenuItem>
    </Menu>
  );
  const actions = (
    <div
      className={cn(
        "flex items-center justify-between",
        focal ? "border-y border-border px-1 py-1.5" : "max-w-[425px]",
      )}
    >
      <Action label="Reply" tone="blue" count={fmt(m.replies)} onClick={() => onOpen?.(post)}>
        <MessageCircle className="size-[18px]" />
      </Action>
      <Action
        label="Repost"
        tone="green"
        pressed={has("retweet")}
        // X counts quotes with reposts on the button.
        count={fmt(m.reposts + m.quotes + shift("retweet"))}
        onClick={() => void act("retweet")}
      >
        <Repeat2 className="size-[18px]" />
      </Action>
      <Action
        label="Like"
        tone="pink"
        pressed={has("like")}
        count={fmt(m.likes + shift("like"))}
        onClick={() => void act("like")}
      >
        <Heart className={cn("size-[18px]", has("like") && "fill-current")} />
      </Action>
      {focal ? null : (
        <Action label="Views" tone="blue" count={fmt(m.views)} onClick={() => onOpen?.(post)}>
          <BarChart2 className="size-[18px]" />
        </Action>
      )}
      <span className="flex items-center gap-3">
        <Action
          label="Bookmark on X"
          tone="blue"
          pressed={has("bookmark")}
          count={
            m.bookmarks + shift("bookmark") > 0 ? fmt(m.bookmarks + shift("bookmark")) : undefined
          }
          onClick={() => void act("bookmark")}
        >
          <Bookmark className={cn("size-[18px]", has("bookmark") && "fill-current")} />
        </Action>
        <Action label="Save to Library" tone="blue" onClick={save}>
          <span className="text-[13px] font-medium">Save</span>
        </Action>
        <Action label="Copy link" tone="blue" onClick={copyLink}>
          <Share className="size-[18px]" />
        </Action>
      </span>
    </div>
  );

  if (focal)
    return (
      <article data-post={post.postId} data-x="post" className="border-b border-border px-4 pt-3">
        {post.context === null ? null : (
          <div className="mb-1 grid grid-cols-[40px_minmax(0,1fr)] gap-x-3">
            <ContextLine context={post.context} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" className="cursor-pointer" onClick={openProfile}>
            <Avatar url={post.avatarUrl} size={40} square={square} />
          </button>
          <div className="min-w-0 text-[15px] leading-5">
            {name}
            <p className={X_GRAY}>@{post.author.handle}</p>
          </div>
          <span className="ml-auto" />
          {author?.youFollow === true ? null : <FollowButton user={author} size="sm" />}
          {menu}
        </div>
        <div className="mt-3 empty:hidden">
          <ReplyingTo handles={post.replyingTo} />
        </div>
        <p className="mt-3 text-[17px] leading-6 break-words whitespace-pre-wrap">
          <RichText text={post.text} entities={post.entities} />
        </p>
        <div className="mt-3 flex flex-col gap-3 empty:hidden">
          {post.media.length === 0 ? null : <Media media={post.media} />}
          {quoted === undefined ? null : <QuoteBox quoted={quoted} onOpen={onOpen} />}
          <Extras post={post} />
          {post.aiGenerated ? <p className={cn("text-[13px]", X_GRAY)}>Made with AI</p> : null}
        </div>
        <p className={cn("mt-4 pb-4 text-[15px]", X_GRAY)}>
          {post.edits.length > 1 ? "Last edited " : ""}
          {xStamp(post.createdAt)}
          {m.views === null ? null : (
            <>
              {" · "}
              <b className="font-bold text-foreground">{m.views.toLocaleString("en")}</b> Views
            </>
          )}
        </p>
        {actions}
        <div className="py-2.5">
          <XtendLine post={post} />
        </div>
      </article>
    );

  return (
    <article
      data-post={post.postId}
      data-x="post"
      data-selected={selected || undefined}
      className={cn(
        "grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 border-b border-border px-4 pt-3 pb-2 transition-colors duration-150",
        onOpen !== undefined && "cursor-pointer hover:bg-white/[0.03]",
        selected && "bg-white/[0.03]",
        threaded && "border-b-0",
      )}
      onClick={() => onOpen?.(post)}
      onMouseEnter={onHover}
    >
      {post.context === null ? null : <ContextLine context={post.context} />}
      <div className="flex flex-col items-center">
        <HoverCard author={post.author} avatarUrl={post.avatarUrl}>
          <button
            type="button"
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              openProfile();
            }}
          >
            <Avatar url={post.avatarUrl} size={40} square={square} />
          </button>
        </HoverCard>
        {threaded ? <span className="mt-1 w-0.5 flex-1 bg-[#333639]" /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2 pb-1">
        <div className="flex min-w-0 items-center gap-1 text-[15px] leading-5">
          {name}
          <span className={cn("min-w-0 truncate", X_GRAY)}>@{post.author.handle}</span>
          <span className={cn("shrink-0", X_GRAY)}>
            ·{" "}
            <time dateTime={post.createdAt} title={xStamp(post.createdAt)}>
              {xAge(post.createdAt)}
            </time>
          </span>
          {menu}
        </div>
        <ReplyingTo handles={post.replyingTo} />
        {post.text === "" ? null : (
          <p className="-mt-1.5 text-[15px] leading-5 break-words whitespace-pre-wrap">
            <RichText text={clampText(post.text) ?? post.text} entities={post.entities} />
            {clampText(post.text) === null ? null : (
              <button
                type="button"
                className="block cursor-pointer text-[#1d9bf0] hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(post);
                }}
              >
                Show more
              </button>
            )}
          </p>
        )}
        <Media media={post.media} />
        {quoted === undefined ? null : <QuoteBox quoted={quoted} onOpen={onOpen} />}
        <Extras post={post} />
        {post.aiGenerated ? <p className={cn("text-[13px]", X_GRAY)}>Made with AI</p> : null}
        {actions}
        <XtendLine post={post} />
      </div>
    </article>
  );
}
