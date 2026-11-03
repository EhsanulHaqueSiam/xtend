import { useAtomValue } from "@effect/atom-react";
import type { TextStyle } from "@xtend/contracts";
import { Bold, Italic } from "lucide-react";
import { type ComponentProps, type KeyboardEvent, type Ref, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { canFormatAtom } from "../../state/engine";
import { xPillSm, xPillSolid } from "../x";
import { Popover } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { XLink } from "../ui/x-link";
import { hasStyle, styledRuns, toggleStyle } from "./textStyles";

type Style = TextStyle["style"];

// X's own upsell for formatting ("sidebar_longform"), in X's words, and the page its button opens.
const UPSELL_TITLE = "Subscribe to Plus to write your own longer posts";
const UPSELL_TEXT = "Write longer posts and apply text formatting such as bold and italic.";
const UPGRADE = "https://x.com/i/premium_sign_up?referring_page=sidebar_longform";

const MAC = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** The style X's own shortcut applies (⌘B and ⌘I, Ctrl off a Mac), or null for any other key. */
export const styleKey = (e: KeyboardEvent): Style | null => {
  if (!(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return key === "b" ? "Bold" : key === "i" ? "Italic" : null;
};

/**
 * X's Bold and Italic for the selection. Only X's composer applies them, so they show only where
 * the session posts; for an account X does not let format, each opens X's own upsell instead.
 */
export function FormatTools({
  styles,
  selection,
  onChange,
  className,
}: {
  readonly styles: ReadonlyArray<TextStyle>;
  readonly selection: { readonly start: number; readonly end: number };
  readonly onChange: (styles: ReadonlyArray<TextStyle>) => void;
  readonly className: string;
}) {
  const can = useAtomValue(canFormatAtom);
  return (["Bold", "Italic"] as const).map((style) => (
    <FormatButton
      key={style}
      style={style}
      className={className}
      // X's toolbar shows a style on when the selection has it.
      pressed={can ? hasStyle(styles, selection.start, selection.end, style) : null}
      onPress={
        can ? () => onChange(toggleStyle(styles, selection.start, selection.end, style)) : null
      }
    />
  ));
}

function FormatButton({
  style,
  className,
  pressed,
  onPress,
}: {
  readonly style: Style;
  readonly className: string;
  readonly pressed: boolean | null;
  /** Null for an account X does not let format: the press opens X's upsell. */
  readonly onPress: (() => void) | null;
}) {
  const [upsell, setUpsell] = useState(false);
  const Icon = style === "Bold" ? Bold : Italic;
  const button = (
    <TooltipTrigger
      render={
        <button
          type="button"
          aria-label={style}
          aria-pressed={pressed ?? undefined}
          className={cn(className, pressed === true && "bg-white/10")}
          // Keeps the selection in the text, which is what the press formats.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPress ?? undefined}
        />
      }
    >
      <Icon className="size-[18px]" />
    </TooltipTrigger>
  );
  return (
    <Tooltip>
      {onPress !== null ? (
        button
      ) : (
        <Popover open={upsell} onOpenChange={setUpsell} align="start" trigger={button}>
          <p className="text-[15px] font-bold">{UPSELL_TITLE}</p>
          <p className="mt-1 text-muted-foreground">{UPSELL_TEXT}</p>
          <XLink href={UPGRADE} label="Subscribe on X" className={cn(xPillSolid, xPillSm, "mt-3")}>
            Subscribe
          </XLink>
        </Popover>
      )}
      <TooltipPopup>{`${style} (${MAC ? "⌘" : "Ctrl"}+${style[0]})`}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * A textarea that shows its text's bold and italic: a textarea cannot style a run, so its own text
 * goes clear while it has any, and a layer under it draws the text where the caret expects it.
 * `font` is the classes the layer shares with the textarea: font, color, padding.
 */
export function StyledArea({
  styles,
  font,
  className,
  onScroll,
  ...props
}: ComponentProps<"textarea"> & {
  readonly styles: ReadonlyArray<TextStyle>;
  readonly font: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const styled = styles.length > 0;
  return (
    <div className="relative">
      {styled ? (
        <StyledLayer
          ref={(el) => {
            layer.current = el;
            // Drawn under a textarea already scrolled, it starts where the textarea is.
            if (el !== null) el.scrollTop = el.nextElementSibling?.scrollTop ?? 0;
          }}
          text={String(props.value ?? "")}
          styles={styles}
          className={font}
        />
      ) : null}
      <textarea
        {...props}
        className={cn(className, font, styled && "text-transparent caret-foreground")}
        onScroll={(e) => {
          onScroll?.(e);
          if (layer.current !== null) layer.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

function StyledLayer({
  text,
  styles,
  className,
  ref,
}: {
  readonly text: string;
  readonly styles: ReadonlyArray<TextStyle>;
  readonly className: string;
  readonly ref: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap",
        className,
      )}
    >
      {/* Bold is a stroke, so its glyphs keep their width; italic is the font's own, in plain
          inline runs that wrap where the textarea does, about a pixel wider over a run. */}
      {styledRuns(text, 0, styles).map((r) =>
        r.bold || r.italic ? (
          <span
            key={r.start}
            className={cn(
              r.bold && "[-webkit-text-stroke:0.04em_currentColor]",
              r.italic && "italic",
            )}
          >
            {r.text}
          </span>
        ) : (
          r.text
        ),
      )}
      {/* The line the textarea gives a trailing newline; a div gives it none. */}
      <br />
    </div>
  );
}
