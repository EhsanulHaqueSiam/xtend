import type { ReactNode } from "react";

import { cn } from "../lib/utils";

/**
 * Control shapes for the screens that draw X content (the composer, post
 * previews), in Xtend's tokens: 8px buttons with a hairline and a quiet action
 * row. The post itself keeps X's shape (avatar, 15px text); the controls
 * around it are Xtend's.
 */
export const xPill =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--control-radius)] border border-white/13 px-3 text-[13px] font-medium text-foreground transition-[background-color,scale] duration-150 hover:bg-white/[0.05] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const xPillSolid = cn(
  xPill,
  "border-transparent bg-foreground text-background hover:bg-white",
);
export const xPillSm = "h-7 px-2.5 text-xs";
export const xAction =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--control-radius)] px-2 py-1 text-[13px] text-muted-foreground transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";
export const xIconButton =
  "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-muted-foreground transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";

/** A companion group: a small label, its actions, a hairline under the content. No card. */
export function XCard({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="border-b border-border pb-4 last:border-b-0">
      <h2 className="flex items-center gap-2 py-2 text-[12.5px] font-semibold text-foreground/80">
        <span className="flex-1">{title}</span>
        {aside}
      </h2>
      {children}
    </section>
  );
}
