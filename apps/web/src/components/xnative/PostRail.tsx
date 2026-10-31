import { useNavigate } from "@tanstack/react-router";
import type { EnginePost } from "@xtend/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { fmt } from "../analyze/ui";
import { useDropPost } from "../shell/drops";
import { engagement, viewsPerHour, vsAuthor } from "./format";
import { Avatar, postUrl, Verified } from "./XPostView";

/** A rail group in X's own shape: a hairline box with a bold title. */
export function RailPanel({
  title,
  children,
}: {
  readonly title?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.12] px-4 py-3">
      {title === undefined ? null : (
        <h2 className="mb-2.5 text-[17px] leading-6 font-extrabold tracking-[-0.01em]">{title}</h2>
      )}
      {children}
    </section>
  );
}

function Row({ k, v, tone }: { readonly k: string; readonly v: string; readonly tone?: "up" }) {
  return (
    <>
      <dt className="text-[#71767b]">{k}</dt>
      <dd
        className={cn(
          "text-right font-mono text-[13px] tabular-nums",
          tone === "up" && "text-success-foreground",
        )}
      >
        {v}
      </dd>
    </>
  );
}

/**
 * Xtend beside X: how the post under focus is doing and who wrote it, read from what the engine
 * already received. Nothing here fetches or costs anything.
 */
export function PostRail({
  post,
  seen,
  onReply,
}: {
  readonly post: EnginePost | undefined;
  readonly seen: Iterable<EnginePost>;
  readonly onReply?: ((post: EnginePost) => void) | undefined;
}) {
  const navigate = useNavigate();
  const drop = useDropPost();
  if (post === undefined)
    return (
      <RailPanel title="This post">
        <p className="text-[13px] text-[#71767b]">
          Point at a post or press J to see how it is doing.
        </p>
      </RailPanel>
    );
  const er = engagement(post);
  const vph = viewsPerHour(post);
  const ratio = vsAuthor(post, seen);
  const a = post.author;
  return (
    <>
      <RailPanel title="This post">
        <dl data-x="rail" className="grid grid-cols-[1fr_auto] gap-y-2 text-[13.5px]">
          {post.metrics.views === null ? null : (
            <Row k="Views" v={post.metrics.views.toLocaleString("en")} />
          )}
          {er === null ? null : <Row k="Engagement rate" v={`${(er * 100).toFixed(1)}%`} />}
          {vph === null ? null : <Row k="Views per hour" v={fmt(Math.round(vph))} />}
          {ratio === null ? null : (
            <Row
              k={`vs @${a.handle}'s usual`}
              v={`${ratio.toFixed(1)}×`}
              {...(ratio >= 1.5 ? { tone: "up" as const } : {})}
            />
          )}
          <Row k="Replies" v={fmt(post.metrics.replies)} />
          <Row k="Bookmarks" v={fmt(post.metrics.bookmarks)} />
        </dl>
        <div className="mt-3.5 flex gap-2">
          {onReply === undefined ? null : (
            <button
              type="button"
              className="h-8 cursor-pointer rounded-full bg-foreground px-3.5 text-[13px] font-bold text-background transition-opacity duration-150 hover:opacity-90"
              onClick={() => onReply(post)}
            >
              Reply with angles
            </button>
          )}
          <button
            type="button"
            className="h-8 cursor-pointer rounded-full border border-white/[0.18] px-3.5 text-[13px] font-bold transition-colors duration-150 hover:bg-white/[0.06]"
            onClick={() =>
              drop("/library", { postId: post.postId, handle: a.handle, url: postUrl(post) })
            }
          >
            Save
          </button>
        </div>
      </RailPanel>
      <RailPanel>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-3 text-left"
          onClick={() => void navigate({ to: "/u/$handle", params: { handle: a.handle } })}
        >
          <Avatar url={post.avatarUrl} size={40} />
          <span className="min-w-0 flex-1 text-[15px] leading-5">
            <span className="flex items-center gap-1">
              <b className="truncate font-bold">{a.name}</b>
              {a.verified ? <Verified /> : null}
            </span>
            <span className="block truncate text-[#71767b]">@{a.handle}</span>
          </span>
        </button>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-2 text-[13.5px]">
          {a.followers === null ? null : <Row k="Followers" v={fmt(a.followers)} />}
        </dl>
        <button
          type="button"
          className="mt-3 cursor-pointer text-[13px] text-[#1d9bf0] hover:underline"
          onClick={() => void navigate({ href: `/scores?tab=report&handle=${a.handle}` })}
        >
          Score report
        </button>
      </RailPanel>
      <p className="px-1 font-mono text-[11.5px] leading-5 text-muted-foreground">
        J/K move · Enter open · L like · S save · O open on X
      </p>
    </>
  );
}
