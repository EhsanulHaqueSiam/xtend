import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Popovers and menus for Compose and Plan. They grow from their trigger: opacity and
 * scale .97 to 1 in 150ms on a strong ease-out, and leave the same way.
 */
const POPUP =
  "origin-(--transform-origin) rounded-[var(--control-radius)] border border-white/13 bg-surface-raised text-foreground shadow-lg shadow-black/50 outline-hidden transition-[opacity,scale] duration-150 ease-[cubic-bezier(.23,1,.32,1)] data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0";

type Side = "top" | "bottom";
type Align = "start" | "center" | "end";

/** A panel under its trigger, for a confirm step or a small form. `trigger` is the button element. */
export function Popover({
  trigger,
  open,
  onOpenChange,
  side = "bottom",
  align = "end",
  className,
  children,
}: {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side?: Side;
  readonly align?: Align;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side={side} align={align} sideOffset={6} className="z-50">
          <PopoverPrimitive.Popup className={cn(POPUP, "w-80 p-3 text-[13px]", className)}>
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/** A list of choices under its trigger. Items are `MenuItem`s. */
export function Menu({
  trigger,
  label,
  align = "start",
  children,
}: {
  readonly trigger: ReactElement;
  /** What the list offers, read first by screen readers. */
  readonly label: string;
  readonly align?: Align;
  readonly children: ReactNode;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align={align} sideOffset={4} className="z-50">
          <MenuPrimitive.Popup
            aria-label={label}
            className={cn(POPUP, "max-h-80 min-w-56 max-w-80 overflow-y-auto p-1")}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}

export function MenuItem({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <MenuPrimitive.Item
      className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-hidden select-none data-highlighted:bg-white/[0.06]"
      onClick={onClick}
    >
      {children}
    </MenuPrimitive.Item>
  );
}
