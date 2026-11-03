import type { TextStyle } from "@xtend/contracts";

type Style = TextStyle["style"];

/** Each style's runs sorted and joined where they touch; empty runs dropped. */
const normalize = (styles: ReadonlyArray<TextStyle>): ReadonlyArray<TextStyle> => {
  const out: Array<TextStyle> = [];
  for (const style of ["Bold", "Italic"] as const)
    for (const run of styles
      .filter((s) => s.style === style && s.start < s.end)
      .toSorted((a, b) => a.start - b.start)) {
      const last = out.at(-1);
      if (last?.style === style && run.start <= last.end)
        out[out.length - 1] = { ...last, end: Math.max(last.end, run.end) };
      else out.push(run);
    }
  return out;
};

/**
 * Whether X's button for `style` shows on: all of the selection has it, or with nothing selected,
 * the character before the caret, as X's composer reads its current style.
 */
export const hasStyle = (
  styles: ReadonlyArray<TextStyle>,
  start: number,
  end: number,
  style: Style,
) =>
  normalize(styles).some((s) =>
    s.style !== style
      ? false
      : start < end
        ? s.start <= start && s.end >= end
        : s.start < start && start <= s.end,
  );

/** Bold or italic on the selection as X's toolbar does it: off when all of it has it already, else on. */
export const toggleStyle = (
  styles: ReadonlyArray<TextStyle>,
  start: number,
  end: number,
  style: Style,
): ReadonlyArray<TextStyle> => {
  if (start >= end) return styles;
  if (!hasStyle(styles, start, end, style)) return normalize([...styles, { start, end, style }]);
  return normalize(
    styles.flatMap((s) =>
      s.style !== style || s.end <= start || s.start >= end
        ? [s]
        : [
            ...(s.start < start ? [{ ...s, end: start }] : []),
            ...(s.end > end ? [{ ...s, start: end }] : []),
          ],
    ),
  );
};

/**
 * The runs once the text changed from `before` to `after` with the caret at `caret`, as typing in
 * X's composer moves them: what is typed at a run's end joins it, at its start does not, and what
 * replaces a selection takes the style of its first character. The caret places an edit the texts
 * alone leave open ("l" typed before "ll").
 */
export function shiftStyles(
  styles: ReadonlyArray<TextStyle>,
  before: string,
  after: string,
  caret = after.length,
): ReadonlyArray<TextStyle> {
  if (styles.length === 0 || before === after) return styles;
  let kept = 0;
  const tailMax = Math.min(before.length, after.length - caret);
  while (kept < tailMax && before[before.length - 1 - kept] === after[after.length - 1 - kept])
    kept++;
  let p = 0;
  while (p < before.length - kept && p < after.length - kept && before[p] === after[p]) p++;
  // [p, gone) of `before` became [p, p + typed) of `after`.
  const gone = before.length - kept;
  const typed = after.length - kept - p;
  const delta = after.length - before.length;
  return normalize(
    styles.map((s) => ({
      ...s,
      start:
        s.start < p || (s.start === p && gone > p)
          ? s.start
          : s.start >= gone
            ? s.start + delta
            : p + typed,
      end:
        s.end < p ? s.end : s.end > gone ? s.end + delta : s.end === p && gone > p ? p : p + typed,
    })),
  );
}

/** The runs inside [from, to) of the text, counted from `from`: what stays when the text is cut there. */
export const sliceStyles = (styles: ReadonlyArray<TextStyle>, from: number, to: number) =>
  normalize(
    styles.map((s) => ({
      ...s,
      start: Math.max(s.start, from) - from,
      end: Math.min(s.end, to) - from,
    })),
  );

/** `text`, which starts at `at` in the post, cut where its bold and italic start and end. */
export function styledRuns(text: string, at: number, styles: ReadonlyArray<TextStyle>) {
  const cuts = new Set([0, text.length]);
  for (const s of styles)
    for (const i of [s.start - at, s.end - at]) if (i > 0 && i < text.length) cuts.add(i);
  const sorted = [...cuts].toSorted((a, b) => a - b);
  return sorted.slice(1).map((end, k) => {
    const start = sorted[k]!;
    const has = (style: Style) =>
      styles.some((s) => s.style === style && s.start <= at + start && s.end >= at + end);
    return { start, text: text.slice(start, end), bold: has("Bold"), italic: has("Italic") };
  });
}
