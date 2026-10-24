/**
 * Menu classes for Base UI's Menu: a raised surface that scales in from its
 * trigger (0.97 to 1 with a fade, 150ms), the shell's account menu shape.
 */
export const menuPopupClass =
  "min-w-44 origin-[var(--transform-origin)] rounded-[var(--radius)] border border-white/13 bg-surface-raised p-1 outline-hidden transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0";

export const menuItemClass =
  "flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-[13px] text-muted-foreground outline-hidden data-highlighted:bg-white/7 data-highlighted:text-foreground";
