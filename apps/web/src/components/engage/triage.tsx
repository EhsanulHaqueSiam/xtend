import type { XPost } from "@xtend/contracts";
import { BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Section } from "../ui/layout";
import { xPill, xPillSm, xPillSolid } from "../x";

/**
 * Engage's triage pieces beside the shared list-and-detail shape
 * (`ui/split.tsx`): the small pills its action rows use, a post's detail head,
 * and a failure line. Leads borrows the pills and the failure line.
 */

export const pill = cn(xPill, xPillSm);
export const pillSolid = cn(xPillSolid, xPillSm);

/** The top of a post's detail: author, when, the full text, then the actions. */
export function PostHead({
  post,
  meta,
  actions,
}: {
  readonly post: XPost;
  readonly meta: string;
  readonly actions: ReactNode;
}) {
  return (
    <Section>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="truncate">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" aria-label="verified" />
        ) : null}
      </div>
      <p className="truncate text-[12.5px] text-muted-foreground">
        @{post.author.handle} · {meta}
      </p>
      <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{post.text}</p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">{actions}</div>
    </Section>
  );
}

/** A failure from the service, in the place the result would have gone. */
export function ErrorLine({ children }: { readonly children: string }) {
  return <p className="px-6 py-3 text-xs text-error-foreground">{children}</p>;
}

/** "3m", "2h", "5d": lists are dense, so no words. */
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
