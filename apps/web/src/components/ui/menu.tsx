import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { popupClass } from "./popover";

/** A list of choices under its trigger, built from `MenuItem`s. `trigger` is the button element. */
export function Menu({
  trigger,
  label,
  align = "start",
  children,
}: {
  readonly trigger: ReactElement;
  /** What the list offers, read first by screen readers. */
  readonly label?: string;
  readonly align?: MenuPrimitive.Positioner.Props["align"];
  readonly children: ReactNode;
}) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner side="bottom" align={align} sideOffset={4} className="z-50">
          <MenuPrimitive.Popup
            aria-label={label}
            className={cn(popupClass, "max-h-80 min-w-44 max-w-80 overflow-y-auto p-1")}
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
      className="flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-[13px] text-muted-foreground outline-hidden select-none data-highlighted:bg-white/7 data-highlighted:text-foreground"
      onClick={onClick}
    >
      {children}
    </MenuPrimitive.Item>
  );
}
