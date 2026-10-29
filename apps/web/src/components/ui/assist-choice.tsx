import type { ReplyTone } from "@xtend/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { xPill, xPillSm } from "../x";

const pill = cn(xPill, xPillSm);

/** The chooser's tones, in the order the spec shows them. */
const TONES: ReadonlyArray<{ readonly tone: ReplyTone; readonly label: string }> = [
  { tone: "agree", label: "Agree" },
  { tone: "add", label: "Add a point" },
  { tone: "ask", label: "Ask" },
  { tone: "contrarian", label: "Contrarian" },
  { tone: "sarcastic", label: "Sarcastic" },
  { tone: "warm", label: "Warm" },
  { tone: "short", label: "Short" },
];

/**
 * Assist is a choice: the user's own words first (`first`, null tone), then a taste. What a
 * click does is the caller's: the reply and DM boxes draft at once, Compose only picks the
 * tone its actions will use.
 */
export function ToneRow({
  tone,
  onTone,
  first = "Write my own",
  busy,
  disabled = false,
  assistDisabled = false,
  cost,
}: {
  /** The pressed chip: null is `first`, undefined is none yet. */
  readonly tone: ReplyTone | null | undefined;
  readonly onTone: (tone: ReplyTone | null) => void;
  readonly first?: string;
  /** The chip being drafted, which reads "Drafting…": null is `first`, undefined is none. */
  readonly busy?: ReplyTone | null | undefined;
  readonly disabled?: boolean;
  /** Tones off while the model has no price yet; the first chip stays on. */
  readonly assistDisabled?: boolean;
  /** The drafts' price, at the row's end, when the section header has no room for it. */
  readonly cost?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tone">
      <button
        type="button"
        className={pill}
        aria-pressed={tone === null}
        disabled={disabled}
        onClick={() => onTone(null)}
      >
        {busy === null ? "Drafting…" : first}
      </button>
      {TONES.map((t) => (
        <button
          key={t.tone}
          type="button"
          className={pill}
          aria-pressed={tone === t.tone}
          disabled={disabled || assistDisabled}
          onClick={() => onTone(t.tone)}
        >
          {busy === t.tone ? "Drafting…" : t.label}
        </button>
      ))}
      {cost === undefined ? null : <span className="ml-auto self-center">{cost}</span>}
    </div>
  );
}

/** Candidates A, B, C: picking one puts it where the user edits it; nothing is sent from here. */
export function Candidates({
  drafts,
  picked,
  onPick,
  disabled = false,
}: {
  readonly drafts: ReadonlyArray<string>;
  /** The text in the editor, so the matching candidate reads as picked. */
  readonly picked: string;
  readonly onPick: (text: string) => void;
  readonly disabled?: boolean;
}) {
  if (drafts.length === 0) return null;
  return (
    <ol className="divide-y divide-border border-y border-border" aria-label="Drafts">
      {drafts.map((d, i) => (
        <li key={d}>
          <button
            type="button"
            aria-pressed={d === picked}
            className="flex w-full cursor-pointer gap-2.5 py-1.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground"
            disabled={disabled}
            onClick={() => onPick(d)}
          >
            <span className="font-mono text-xs">{String.fromCharCode(65 + i)}</span>
            <span className="whitespace-pre-wrap">{d}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
