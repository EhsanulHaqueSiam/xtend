import { useAtomSet } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { useState } from "react";

import {
  assistContinueAtom,
  assistHookAtom,
  assistRewriteAtom,
  assistThreadIdeasAtom,
  assistVoiceMatchAtom,
} from "../../state/compose";
import { Button } from "../ui/button";
import { inputClass } from "./ThreadEditor";

/** One assist answer, flattened so the panel renders every task the same way. */
interface Suggestion {
  readonly text: string;
  readonly note?: string;
  readonly blocks: ReadonlyArray<string>;
}

export const failText = (cause: Cause.Cause<unknown>) => {
  const e = Cause.squash(cause);
  return e instanceof Error ? e.message : String(e);
};

export function AssistPanel({
  blocks,
  active,
  onReplaceBlock,
  onInsertAfter,
  onReplaceAll,
}: {
  readonly blocks: ReadonlyArray<string>;
  readonly active: number;
  readonly onReplaceBlock: (index: number, text: string) => void;
  readonly onInsertAfter: (index: number, texts: ReadonlyArray<string>) => void;
  readonly onReplaceAll: (blocks: ReadonlyArray<string>) => void;
}) {
  const hook = useAtomSet(assistHookAtom, { mode: "promiseExit" });
  const rewrite = useAtomSet(assistRewriteAtom, { mode: "promiseExit" });
  const ideas = useAtomSet(assistThreadIdeasAtom, { mode: "promiseExit" });
  const cont = useAtomSet(assistContinueAtom, { mode: "promiseExit" });
  const voice = useAtomSet(assistVoiceMatchAtom, { mode: "promiseExit" });

  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<ReadonlyArray<Suggestion>>([]);
  const [use, setUse] = useState<(s: Suggestion) => void>(() => () => {});

  const run = async <A,>(
    name: string,
    call: () => Promise<Exit.Exit<A, unknown>>,
    toItems: (a: A) => ReadonlyArray<Suggestion>,
    onUse: (s: Suggestion) => void,
  ) => {
    setBusy(name);
    setError(null);
    const exit = await call();
    setBusy(null);
    if (Exit.isFailure(exit)) {
      setError(failText(exit.cause));
      return;
    }
    setTitle(name);
    setItems(toItems(exit.value));
    setUse(() => onUse);
  };

  const first = blocks[0] ?? "";
  const current = blocks[active] ?? "";

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null || first.trim() === ""}
          onClick={() =>
            run(
              "Improve hook",
              () => hook(blocks),
              (r) => r.alternatives.map((a) => ({ text: a.text, note: a.reason, blocks: [] })),
              (s) => onReplaceBlock(0, s.text),
            )
          }
        >
          Improve hook
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null || current.trim() === ""}
          onClick={() =>
            run(
              `Rewrite post ${active + 1}`,
              () => rewrite(current),
              (r) => r.variants.map((text) => ({ text, blocks: [] })),
              (s) => onReplaceBlock(active, s.text),
            )
          }
        >
          Rewrite
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null || first.trim() === ""}
          onClick={() =>
            run(
              "Continue thread",
              () => cont(blocks),
              (r) => [{ text: r.blocks.join("\n\n"), blocks: r.blocks }],
              (s) => onInsertAfter(blocks.length - 1, s.blocks),
            )
          }
        >
          Continue thread
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null || first.trim() === ""}
          onClick={() =>
            run(
              "Voice match",
              () => voice(blocks),
              (r) => [
                {
                  text: `${Math.round(r.score * 100)}% match against ${r.samples} recent posts`,
                  note: r.note,
                  blocks: [],
                },
              ],
              () => {},
            )
          }
        >
          Voice match
        </Button>
      </div>
      <div className="flex gap-1.5">
        <input
          className={inputClass}
          placeholder="Topic for thread ideas"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <Button
          variant="outline"
          size="xs"
          disabled={busy !== null || topic.trim() === ""}
          onClick={() =>
            run(
              "Thread ideas",
              () => ideas(topic),
              (r) =>
                r.outlines.map((o) => ({
                  text: o.hook,
                  note: o.beats.join(" · "),
                  blocks: [o.hook, ...o.beats],
                })),
              (s) => onReplaceAll(s.blocks),
            )
          }
        >
          Ideas
        </Button>
      </div>
      {busy !== null ? <p className="text-2xs text-muted-foreground">{busy}…</p> : null}
      {error !== null ? <p className="text-2xs text-error-foreground">{error}</p> : null}
      {items.length > 0 ? (
        <div className="flex flex-col divide-y divide-border">
          <p className="pb-1 text-2xs text-muted-foreground">{title}</p>
          {items.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key -- suggestions are unkeyed model output.
            <div key={i} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{s.text}</p>
                {s.note !== undefined ? (
                  <p className="mt-0.5 text-2xs text-muted-foreground">{s.note}</p>
                ) : null}
              </div>
              {title !== "Voice match" ? (
                <Button variant="ghost" size="xs" onClick={() => use(s)}>
                  Use
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
