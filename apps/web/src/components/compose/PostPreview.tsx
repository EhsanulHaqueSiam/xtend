import { useAtomValue } from "@effect/atom-react";
import type { DraftBlock, DraftMedia } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { savedPostAtom } from "../../state/library";
import { Button } from "../ui/button";

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
      <p className="mt-2 truncate text-[13px] text-info-foreground" data-testid="quote-link">
        {url}
      </p>
    );
  return (
    <div className="mt-2 rounded-md border border-border px-3 py-2" data-testid="quote-card">
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

/** Looks like an X post card: avatar, name, handle, then each block as a thread. Phone or desktop width. */
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {(["phone", "desktop"] as const).map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="xs"
            data-active={frame === f || undefined}
            className="data-active:bg-accent"
            onClick={() => setFrame(f)}
          >
            {f}
          </Button>
        ))}
      </div>
      <div
        className={cn(
          "rounded-md border border-border bg-card",
          frame === "phone" ? "w-[340px] rounded-3xl border-2 px-1 py-4" : "w-full",
        )}
      >
        {blocks.map(({ text }, i) => (
          // eslint-disable-next-line react/no-array-index-key -- blocks are plain strings; position is their identity.
          <div key={i} className="flex gap-3 px-4 py-3">
            <div className="flex flex-col items-center">
              {avatarUrl !== null ? (
                <img src={avatarUrl} alt="" className="size-10 shrink-0 rounded-full" />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {initials(name)}
                </div>
              )}
              {i < blocks.length - 1 ? <div className="mt-1 w-0.5 flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 text-sm">
                <span className="truncate font-semibold">{name}</span>
                <span className="truncate text-muted-foreground">@{handle ?? "you"} · now</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-normal">
                {text === "" ? <span className="text-placeholder">Your post</span> : text}
              </p>
              {media.some((m) => m.blockIndex === i) ? (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {media
                    .filter((m) => m.blockIndex === i)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-muted text-2xs text-muted-foreground"
                      >
                        {previews[m.id] !== undefined && m.kind === "image" ? (
                          <img src={previews[m.id]} alt={m.alt} className="h-full w-full object-cover" />
                        ) : (
                          m.kind
                        )}
                      </div>
                    ))}
                </div>
              ) : null}
              {i === 0 && quoteUrl !== null && quoteUrl !== "" ? <QuoteCard url={quoteUrl} /> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
