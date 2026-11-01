import { cn } from "../../lib/utils";

/** On or off. The thumb slides 150ms on a click (transform only); nothing else moves. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Names the switch for screen readers when no label element wraps it. */
  readonly label?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      // Rows that open on click hold switches; flipping one must not open the row too.
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "group relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-[9px] bg-white/13 outline-hidden transition-[background-color] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-checked:bg-success",
        className,
      )}
    >
      <span className="size-3.5 translate-x-0.5 rounded-full bg-foreground transition-[translate] duration-150 ease-[cubic-bezier(.23,1,.32,1)] group-aria-checked:translate-x-[14px]" />
    </button>
  );
}
