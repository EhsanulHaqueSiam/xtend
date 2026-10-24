import { useAtomValue } from "@effect/atom-react";
import type { DraftBlock, DraftMedia } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { savedPostAtom } from "../../state/library";
import { XCard } from "../x";

/** The post id in an x.com status link, or null when the text is not one. */
export const quotedPostId = (url: string) =>
  /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d+)/.exec(url.trim())?.[1] ??
  null;

/** The quoted post as a card when the library has it saved; otherwise the bare link, which is what X will get. */
export function QuoteCard({ url }: { readonly url: string }) {
  const postId = quotedPostId(url);
  const saved = useAtomValue(savedPostAtom(postId ?? ""));
  const post = postId === null ? null : AsyncResult.getOrElse(saved, () => null);
  if (post === null)
    return (
      <p
        className="mt-2 truncate font-mono text-2xs text-muted-foreground"
        data-testid="quote-link"
      >
        {url}
      </p>
    );
  return (
    <div className="mt-2 rounded-xl border border-border px-3 py-2" data-testid="quote-card">
      <p className="flex gap-1 text-[13px]">
        <span className="font-semibold">{post.post.author.name}</span>
        <span className="text-muted-foreground">@{post.post.author.handle}</span>
      </p>
      <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[13px]">{post.post.text}</p>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The draft as X will show it, avatar, name and the thread line, in the companion column. */
export function PostPreview({
  blocks,
  media,
  previews,
  quoteUrl,
  name,
  handle,
  avatarUrl,
}: {
  readonly blocks: ReadonlyArray<DraftBlock>;
  readonly media: ReadonlyArray<DraftMedia>;
  readonly previews: Readonly<Record<string, string>>;
  readonly quoteUrl: string | null;
  readonly name: string;
  readonly handle: string | null;
  readonly avatarUrl: string | null;
}) {
  const [frame, setFrame] = useState<"phone" | "desktop">("desktop");
  return (
    <XCard
      title="Preview"
      aside={
        <span className="flex gap-3 text-xs font-normal">
          {(["phone", "desktop"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={frame === f}
              className="cursor-pointer capitalize text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground"
              onClick={() => setFrame(f)}
            >
              {f}
            </button>
          ))}
        </span>
      }
    >
      <div
        className={cn(
          frame === "phone" &&
            "mx-auto max-w-[300px] rounded-[28px] border border-white/13 px-1 pt-4 pb-2",
        )}
      >
        {blocks.map(({ text }, i) => (
          // eslint-disable-next-line react/no-array-index-key -- blocks are plain strings; position is their identity.
          <div key={i} className="flex gap-2.5 px-1 pt-1">
            <div className="flex flex-col items-center">
              {avatarUrl !== null ? (
                <img src={avatarUrl} alt="" className="size-8 shrink-0 rounded-full" />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  {initials(name)}
                </div>
              )}
              {i < blocks.length - 1 ? <div className="mt-1 w-px flex-1 bg-white/13" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <div className="flex items-baseline gap-1 text-[13px]">
                <span className="truncate font-semibold">{name}</span>
                <span className="truncate text-muted-foreground">@{handle ?? "you"} · now</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-[1.4]">
                {text === "" ? <span className="text-placeholder">Your post</span> : text}
              </p>
              {media.some((m) => m.blockIndex === i) ? (
                <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border">
                  {media
                    .filter((m) => m.blockIndex === i)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex h-20 items-center justify-center overflow-hidden bg-surface-raised font-mono text-2xs text-muted-foreground"
                      >
                        {previews[m.id] !== undefined && m.kind === "image" ? (
                          <img
                            src={previews[m.id]}
                            alt={m.alt}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          m.kind
                        )}
                      </div>
                    ))}
                </div>
              ) : null}
              {i === 0 && quoteUrl !== null && quoteUrl !== "" ? (
                <QuoteCard url={quoteUrl} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </XCard>
  );
}
