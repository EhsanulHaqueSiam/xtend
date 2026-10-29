import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * The raised surface under menus and popovers. It grows from its trigger (Base
 * UI's `--transform-origin`): opacity and scale .97 to 1 in 150ms on a strong
 * ease-out, and leaves the same way.
 */
export const popupClass =
  "origin-(--transform-origin) rounded-[var(--radius)] border border-white/13 bg-surface-raised text-foreground shadow-lg shadow-black/50 outline-hidden transition-[opacity,scale] duration-150 ease-[cubic-bezier(.23,1,.32,1)] data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0";

/** A panel under its trigger, for a confirm step or a small form. `trigger` is the button element. */
export function Popover({
  trigger,
  open,
  onOpenChange,
  align = "end",
  className,
  children,
}: {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly align?: PopoverPrimitive.Positioner.Props["align"];
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side="bottom" align={align} sideOffset={6} className="z-50">
          <PopoverPrimitive.Popup
            data-detail-popup
            className={cn(popupClass, "w-80 p-3 text-[13px]", className)}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
