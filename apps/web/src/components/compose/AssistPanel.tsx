import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ReplyTone, XPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Sparkles, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import {
  assistContinueAtom,
  assistHookAtom,
  assistRewriteAtom,
  assistThreadIdeasAtom,
  assistVoiceMatchAtom,
  composeContextAtom,
} from "../../state/compose";
import { useQuoteLabel } from "../../state/costs";
import { searchAtom } from "../../state/library";
import { ToneRow } from "../ui/assist-choice";
import { Button } from "../ui/button";
import { compactInputClass } from "../ui/field";
import { Cost } from "../ui/layout";
import { XCard } from "../x";
import { splitBlocks } from "./ThreadEditor";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEARCHING = "Searching";

/** A label and its value on one line, value in mono on the right. */
function Fact({ label, children }: { readonly label: string; readonly children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 text-[13px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono text-xs tabular-nums">{children}</span>
    </div>
  );
}

/** Where the draft would land (next free slot, best hours) and three library posts like its first line. */
export function ComposeContext({
  firstLine,
  onUse,
}: {
  readonly firstLine: string;
  readonly onUse: (blocks: ReadonlyArray<string>) => void;
}) {
  const context = useAtomValue(composeContextAtom);
  const search = useAtomSet(searchAtom, { mode: "promiseExit" });
  const query = firstLine.trim().slice(0, 80);
  // The mode the search below runs with: each mode is cached apart, so it decides "cached, free".
  const price = useQuoteLabel({ kind: "search", query, mode: "top" });
  const [similar, setSimilar] = useState<ReadonlyArray<XPost> | string | null>(null);
  const ctx = AsyncResult.getOrElse(context, () => null);
  return (
    <XCard title="Context">
      <Fact label="Next slot">
        {ctx === null ? "…" : ctx.nextSlot === null ? "no slots set" : fmtWhen(ctx.nextSlot)}
      </Fact>
      {ctx !== null && ctx.bestHours.length > 0 ? (
        <Fact label="Best hours">
          {ctx.bestHours.map((b) => `${DAYS[b.weekday]} ${b.hour}:00`).join(", ")}
        </Fact>
      ) : null}
      <div className="flex items-center justify-between gap-3 pt-2.5">
        <span className="text-[13px] text-muted-foreground">Similar posts</span>
        <Button
          variant="outline"
          size="xs"
          disabled={query === "" || similar === SEARCHING}
          onClick={async () => {
            setSimilar(SEARCHING);
            const exit = await search({ query, mode: "top" });
            setSimilar(Exit.isFailure(exit) ? failText(exit.cause) : exit.value.items.slice(0, 3));
          }}
        >
          Find similar
          <Cost label={price} />
        </Button>
      </div>
      {typeof similar === "string" ? (
        <p className="pt-2 text-xs text-muted-foreground">{similar}</p>
      ) : similar !== null ? (
        <ul className="mt-2 flex flex-col">
          {similar.length === 0 ? (
            <li className="text-xs text-muted-foreground">Nothing similar found.</li>
          ) : null}
          {similar.map((p) => (
            <li key={p.postId} className="flex items-start gap-2 border-t border-border py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-2xs text-muted-foreground">
                  @{p.author.handle} · {p.metrics.likes} likes
                </p>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[13px]">{p.text}</p>
              </div>
              <Button variant="ghost" size="xs" onClick={() => onUse(splitBlocks(p.text))}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </XCard>
  );
}

/** One assist answer, flattened so the bar renders every task the same way. */
interface Suggestion {
  readonly text: string;
  readonly note?: string;
  readonly blocks: ReadonlyArray<string>;
}

export const failText = (cause: Cause.Cause<unknown>) => {
  const e = Cause.squash(cause);
  return e instanceof Error ? e.message : String(e);
};

/** Voice match reads the handle's recent posts from X before its model call. */
function VoiceMatchCost({ handle, model }: { readonly handle: string; readonly model: string }) {
  return <Cost label={`${useQuoteLabel({ kind: "userPosts", handle })} + ${model}`} />;
}

/**
 * The model's help at the foot of the writing column: a tone that every action takes, one row of
 * actions on the draft and a topic box for thread ideas. Answers open above as three options,
 * each with Use and Dismiss; the editor stays the user's own words. Each action is one model call
 * and shows its price; voice match also reads X.
 */
export function AssistPanel({
  handle,
  blocks,
  active,
  onReplaceBlock,
  onAppend,
  onReplaceAll,
  onVoiceScore,
}: {
  /** The Settings handle whose recent posts voice match reads; none means no read. */
  readonly handle: string | null;
  readonly blocks: ReadonlyArray<string>;
  readonly active: number;
  readonly onReplaceBlock: (index: number, text: string) => void;
  /** Adds posts after the thread's last one, whatever it is by the time Use is clicked. */
  readonly onAppend: (texts: ReadonlyArray<string>) => void;
  readonly onReplaceAll: (blocks: ReadonlyArray<string>) => void;
  /** The voice match score (0 to 1) for the text it was run on, for the page header. */
  readonly onVoiceScore?: (score: number) => void;
}) {
  const hook = useAtomSet(assistHookAtom, { mode: "promiseExit" });
  const rewrite = useAtomSet(assistRewriteAtom, { mode: "promiseExit" });
  const ideas = useAtomSet(assistThreadIdeasAtom, { mode: "promiseExit" });
  const cont = useAtomSet(assistContinueAtom, { mode: "promiseExit" });
  const voice = useAtomSet(assistVoiceMatchAtom, { mode: "promiseExit" });
  const model = useQuoteLabel({ kind: "assist" });

  const [topic, setTopic] = useState("");
  // Picked once, used by every action below until changed; null asks for no particular tone.
  const [picked, setPicked] = useState<ReplyTone | null>(null);
  const tone = picked ?? undefined;
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

  const action = (
    label: string,
    disabled: boolean,
    onClick: () => void,
    cost: ReactNode = <Cost label={model} />,
  ) => (
    <Button variant="ghost-muted" size="xs" disabled={busy !== null || disabled} onClick={onClick}>
      {label}
      {cost}
    </Button>
  );

  return (
    <div className="border-t border-border">
      {busy !== null || error !== null || items.length > 0 ? (
        <div className="max-h-[40vh] overflow-y-auto pt-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span className="flex-1">{busy ?? (error === null ? title : "Assist")}</span>
            {busy === null ? (
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Close suggestions"
                onClick={() => {
                  setItems([]);
                  setError(null);
                }}
              >
                <X />
              </Button>
            ) : null}
          </div>
          {busy !== null ? <p className="py-2 text-xs text-muted-foreground">Writing</p> : null}
          {error !== null ? <p className="py-2 text-xs text-error-foreground">{error}</p> : null}
          {busy === null
            ? items.map((s, i) => (
                // eslint-disable-next-line react/no-array-index-key -- suggestions are unkeyed model output.
                <div key={i} className="border-b border-border py-3 last:border-b-0">
                  <p className="whitespace-pre-wrap text-[14px] leading-normal">{s.text}</p>
                  {s.note !== undefined ? (
                    <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>
                  ) : null}
                  {title !== "Voice match" ? (
                    <div className="mt-2 flex gap-1">
                      <Button variant="outline" size="xs" onClick={() => use(s)}>
                        Use
                      </Button>
                      <Button
                        variant="ghost-muted"
                        size="xs"
                        onClick={() => setItems(items.filter((x) => x !== s))}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            : null}
        </div>
      ) : null}
      <div className="pt-2.5">
        <ToneRow tone={picked} first="Any tone" disabled={busy !== null} onTone={setPicked} />
      </div>
      <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 py-2.5">
        <Sparkles aria-hidden className="mr-1 size-3.5 text-muted-foreground" />
        {action("Improve hook", first.trim() === "", () =>
          run(
            "Improve hook",
            () => hook({ blocks, tone }),
            (r) => r.alternatives.map((a) => ({ text: a.text, note: a.reason, blocks: [] })),
            (s) => onReplaceBlock(0, s.text),
          ),
        )}
        {action("Rewrite", current.trim() === "", () =>
          run(
            `Rewrite post ${active + 1}`,
            () => rewrite({ text: current, tone }),
            (r) => r.variants.map((text) => ({ text, blocks: [] })),
            (s) => onReplaceBlock(active, s.text),
          ),
        )}
        {action("Continue thread", first.trim() === "", () =>
          run(
            "Continue thread",
            () => cont({ blocks, tone }),
            (r) => r.options.map((o) => ({ text: o.blocks.join("\n\n"), blocks: o.blocks })),
            (s) => onAppend(s.blocks),
          ),
        )}
        {action(
          "Voice match",
          first.trim() === "",
          () =>
            run(
              "Voice match",
              () => voice(blocks),
              (r) => {
                onVoiceScore?.(r.score);
                return [
                  {
                    text: `${Math.round(r.score * 100)}% match against ${r.samples} recent posts`,
                    note: r.note,
                    blocks: [],
                  },
                ];
              },
              () => {},
            ),
          handle === null ? undefined : <VoiceMatchCost handle={handle} model={model} />,
        )}
        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (topic.trim() === "" || busy !== null) return;
            void run(
              "Thread ideas",
              () => ideas({ topic, tone }),
              (r) =>
                r.outlines.map((o) => ({
                  text: o.hook,
                  note: o.beats.join(" · "),
                  blocks: [o.hook, ...o.beats],
                })),
              (s) => onReplaceAll(s.blocks),
            );
          }}
        >
          <input
            className={cn(compactInputClass, "w-36")}
            aria-label="Topic for thread ideas"
            placeholder="Thread ideas on…"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            size="xs"
            disabled={busy !== null || topic.trim() === ""}
          >
            Ideas
            <Cost label={model} />
          </Button>
        </form>
      </div>
    </div>
  );
}
