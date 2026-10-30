import type { ReplyTone } from "@xtend/contracts";

/**
 * The reply panel under a post on x.com: assist is a choice. "Write my own" first, then the
 * tones; three candidates to pick from; the editor; one free Reply through the user's own
 * session. Pure markup from state, so the strip can redraw it on every change.
 */

export interface ReplyPanel {
  readonly tone: ReplyTone | null;
  readonly drafts: ReadonlyArray<string>;
  /** The candidate the user picked, or what they typed; the textarea's own value wins while open. */
  readonly text: string;
  readonly busy: "draft" | "reply" | null;
  readonly error: string | null;
  readonly replied: boolean;
}

export const emptyPanel: ReplyPanel = {
  tone: null,
  drafts: [],
  text: "",
  busy: null,
  error: null,
  replied: false,
};

/** Same order as Engage's chooser, so the two places read the same. */
const TONES: ReadonlyArray<{ readonly tone: ReplyTone; readonly label: string }> = [
  { tone: "fit", label: "Best fit" },
  { tone: "mine", label: "My style" },
  { tone: "agree", label: "Agree" },
  { tone: "add", label: "Add a point" },
  { tone: "ask", label: "Ask" },
  { tone: "contrarian", label: "Contrarian" },
  { tone: "sarcastic", label: "Sarcastic" },
  { tone: "warm", label: "Warm" },
  { tone: "short", label: "Short" },
];

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const panelHtml = (p: ReplyPanel): string => {
  const off = p.busy !== null || p.replied ? " disabled" : "";
  const chip = (label: string, attrs: string, pressed: boolean) =>
    `<button class="chip" aria-pressed="${pressed}" ${attrs}${off}>${label}</button>`;
  const tones = [
    chip("Write my own", 'data-tone=""', p.tone === null),
    ...TONES.map((t) =>
      chip(
        p.busy === "draft" && p.tone === t.tone ? "Drafting…" : t.label,
        `data-tone="${t.tone}"`,
        p.tone === t.tone,
      ),
    ),
  ].join("");
  const drafts =
    p.drafts.length === 0
      ? ""
      : `<ol class="drafts" aria-label="Drafts">${p.drafts
          .map(
            (d, i) =>
              `<li><button class="draft" data-draft="${i}" aria-pressed="${d === p.text}"${off}><span class="n">${String.fromCharCode(65 + i)}</span><span>${escape(d)}</span></button></li>`,
          )
          .join("")}</ol>`;
  const send = p.replied
    ? `<button class="send" disabled>Replied</button>`
    : `<button class="send" data-send=""${off}>${p.busy === "reply" ? "Replying…" : "Reply"}<b>free · your session</b></button>`;
  const error = p.error === null ? "" : `<p class="err">${escape(p.error)}</p>`;
  return `<div class="tones" role="group" aria-label="Tone">${tones}</div>${drafts}<textarea class="text" maxlength="280" placeholder="${p.tone === null ? "Write your reply" : "Pick a draft above, or edit it here"}"${off}>${escape(p.text)}</textarea><div class="row">${send}<button class="chip" data-cancel="">Cancel</button></div>${error}`;
};
