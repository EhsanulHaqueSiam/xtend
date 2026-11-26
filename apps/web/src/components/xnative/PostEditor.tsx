import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { charCount, type EnginePost, type TextStyle } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import { useContext, useState } from "react";

import { editPostAtom } from "../../state/compose";
import { canFormatAtom, engineAtom } from "../../state/engine";
import { usePostLimit } from "../../state/settings";
import { xGo, xHere, xNavigate } from "../../state/x";
import { failText } from "../compose/AssistPanel";
import { FormatTools, StyledArea, styleKey } from "../compose/FormatTools";
import { plainEntities, shiftStyles, sliceStyles, toggleStyle } from "../compose/textStyles";
import { toastAtom } from "../ui/toast";
import { xClock } from "./format";

const tool =
  "-m-1.5 grid size-[34px] cursor-pointer place-items-center rounded-full text-[#1d9bf0] transition-colors duration-150 hover:bg-[#1d9bf0]/10";

/**
 * X Premium's Edit post in place of the post's text, for X's own Edit row: the text as X's composer
 * opens it, bold and italic where X lets the account format, and Update through X's Edit post in
 * the user's session, free. X allows it for an hour after posting, up to five times; `font` is the
 * text's own size. A failure keeps what was typed.
 */
export function PostEditor({
  post,
  font,
  onDone,
}: {
  readonly post: EnginePost;
  readonly font: string;
  readonly onDone: () => void;
}) {
  const limit = usePostLimit();
  const canFormat = useAtomValue(canFormatAtom);
  const update = useAtomSet(editPostAtom, { mode: "promiseExit" });
  const setToast = useAtomSet(toastAtom);
  // X's own edit text where it differs from what the post shows (a link expanded, a card's kept).
  const [start] = useState(() => post.edit ?? { text: post.text, styles: post.styles ?? [] });
  const [text, setText] = useState(start.text);
  // X leaves mentions and links plain, so they never hold a run.
  const [styles, setRuns] = useState<ReadonlyArray<TextStyle>>(start.styles);
  const setStyles = (next: ReadonlyArray<TextStyle>, under = text) =>
    setRuns(plainEntities(under, next));
  const [caret, setCaret] = useState({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After Update, while this window shows no new version: X may have saved it (its answer never
  // came), or saved it while this window missed X's answer. Either way, no second Update.
  const [status, setStatus] = useState<string | null>(null);
  const registry = useContext(RegistryContext);

  const length = charCount(text);
  // X keeps Update off until the post changes.
  const changed = text !== start.text || JSON.stringify(styles) !== JSON.stringify(start.styles);
  const ready = !busy && status === null && changed && text.trim() !== "" && length <= limit;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    // Trimmed as X posts it, so the runs move with the text's start.
    const lead = text.length - text.trimStart().length;
    const trimmed = text.trim();
    // The edit takes X to the post's page; X goes back where it was once the edit settles (Home
    // pages on from there), only while it still shows the edit's page, not where the user moved it.
    const before = xHere();
    const putBack = (saved: string | null = null) => {
      const now = xHere();
      const shown = /\/status\/(\d+)/.exec(now ?? "")?.[1];
      const editsPage =
        (shown !== undefined && [post.postId, saved].includes(shown)) ||
        now?.includes("/compose/post") === true;
      if (before !== null && now !== before && editsPage) void xGo(before);
    };
    const exit = await update({
      postId: post.postId,
      text: trimmed,
      styles: sliceStyles(styles, lead, lead + trimmed.length),
    });
    setBusy(false);
    if (Exit.isFailure(exit)) return (putBack(), setError(failText(exit.cause)));
    const saved = exit.value.postId;
    if (saved === null) return (putBack(), setStatus("X may have saved this edit; check the post"));
    if (registry.get(engineAtom).posts.has(saved))
      return (putBack(saved), setToast({ text: "Updated on X" }), onDone());
    // This window missed X's answer: while its X still shows the edited post, it opens the new
    // version once, a read for this click, and X's answer there takes the post's place.
    setStatus("Updated on X; reload the post to see it");
    // Only while this window's X still shows the edited post, never over where the user moved it.
    if (/\/status\/(\d+)/.exec(xHere() ?? "")?.[1] === post.postId)
      void xNavigate(`https://x.com/${post.author.handle}/status/${saved}`);
  };

  const left =
    post.editsRemaining === null
      ? null
      : post.editsRemaining === 1
        ? "last edit"
        : `${post.editsRemaining} edits left`;
  const line = [
    left,
    post.editableUntil === null ? null : `until ${xClock(post.editableUntil)}`,
    "free",
    `${length}/${limit.toLocaleString("en")}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    // React carries a click up to the post, which would open it.
    <div data-x="edit" className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="rounded-lg border border-[#1d9bf0] p-2">
        <StyledArea
          styles={styles}
          font={font}
          aria-label="Edit post text"
          autoFocus
          disabled={busy}
          className="block max-h-[60vh] w-full resize-none bg-transparent outline-hidden field-sizing-content"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setStyles(
              shiftStyles(styles, text, e.target.value, e.target.selectionEnd),
              e.target.value,
            );
            setCaret({ start: e.target.selectionStart, end: e.target.selectionEnd });
          }}
          onSelect={(e) =>
            setCaret({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })
          }
          onKeyDown={(e) => {
            const style = canFormat ? styleKey(e) : null;
            if (style !== null) {
              e.preventDefault();
              return setStyles(toggleStyle(styles, caret.start, caret.end, style));
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
        />
      </div>
      <div className="flex items-center gap-2.5">
        {/* Only where X lets the account format: Edit post is Premium's, as bold and italic are. */}
        {canFormat ? (
          <FormatTools styles={styles} selection={caret} onChange={setStyles} className={tool} />
        ) : null}
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{line}</span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={busy}
          className="h-8 cursor-pointer rounded-full border border-[#536471] px-4 text-[14px] font-bold transition-colors duration-150 hover:bg-white/[0.05] disabled:cursor-default disabled:opacity-50"
          onClick={onDone}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          className="h-8 cursor-pointer rounded-full bg-foreground px-4 text-[14px] font-bold text-background transition-opacity duration-150 disabled:cursor-default disabled:opacity-50"
          onClick={() => void save()}
        >
          Update
        </button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs text-error-foreground">
          {error}
        </p>
      )}
      {status === null ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
