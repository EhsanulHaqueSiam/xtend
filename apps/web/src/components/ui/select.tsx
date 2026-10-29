import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils";
import { compactInputClass, inputClass } from "./field";
import { popupClass } from "./popover";

export interface SelectOption<T> {
  readonly value: T;
  readonly label: string;
}

/**
 * A choice of one from a short list, in the app's own popup. Use it instead of a native
 * `<select>`: Electron on Linux draws native lists white over the black canvas. Any value
 * type works, `undefined` and `null` included, since items are matched by position.
 */
export function Select<const T>({
  value,
  onChange,
  options,
  label,
  compact = false,
  className,
}: {
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly options: ReadonlyArray<SelectOption<T>>;
  /** Read by screen readers when no visible label names the control. */
  readonly label?: string;
  /** 28px tall, for headers and dense rows. */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const index = String(options.findIndex((o) => Object.is(o.value, value)));
  return (
    <SelectPrimitive.Root
      value={index}
      items={options.map((o, i) => ({ value: String(i), label: o.label }))}
      onValueChange={(next) => {
        const picked = options[Number(next)];
        if (picked !== undefined) onChange(picked.value);
      }}
    >
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          compact ? compactInputClass : inputClass,
          "inline-flex w-auto max-w-full cursor-pointer items-center justify-between gap-1.5 text-left data-popup-open:border-white/30",
          className,
        )}
      >
        <SelectPrimitive.Value className="truncate" />
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          alignItemWithTrigger={false}
          className="z-50"
        >
          <SelectPrimitive.Popup
            className={cn(
              popupClass,
              "max-h-80 min-w-(--anchor-width) max-w-80 overflow-y-auto p-1",
            )}
          >
            {options.map((o, i) => (
              <SelectPrimitive.Item
                key={o.label}
                value={String(i)}
                className="flex cursor-pointer items-center gap-2 rounded-[calc(var(--radius)-4px)] py-1.5 pr-2 pl-2 text-[13px] text-muted-foreground outline-hidden select-none data-highlighted:bg-white/7 data-highlighted:text-foreground data-selected:text-foreground"
              >
                <SelectPrimitive.ItemText className="flex-1">{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
