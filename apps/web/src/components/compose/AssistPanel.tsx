import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { XPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { type ReactNode, useState } from "react";

import { fmtWhen } from "../../lib/time";
import {
  assistContinueAtom,
  assistHookAtom,
  assistRewriteAtom,
  assistThreadIdeasAtom,
  assistVoiceMatchAtom,
  composeContextAtom,
} from "../../state/compose";
import { Sparkles } from "lucide-react";

import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { searchAtom } from "../../state/library";
import { xAction, XCard, xMeta, xPill, xPillSm, xPillSolid } from "../x";
import { splitBlocks } from "./ThreadEditor";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEARCHING = "Searching…";

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
  const price = useQuoteLabel({ kind: "search", query });
  const [similar, setSimilar] = useState<ReadonlyArray<XPost> | string | null>(null);
  const ctx = AsyncResult.getOrElse(context, () => null);
  return (
    <XCard title="Context">
      <div className="px-4 pb-3">
        <p className={xMeta}>Next slot</p>
        <p className="text-[15px] font-bold">
          {ctx === null ? "…" : ctx.nextSlot === null ? "No slots set" : fmtWhen(ctx.nextSlot)}
        </p>
      </div>
      {ctx !== null && ctx.bestHours.length > 0 ? (
        <div className="px-4 pb-3">
          <p className={xMeta}>Best hours</p>
          <p className="text-[15px]">
            {ctx.bestHours.map((b) => `${DAYS[b.weekday]} ${b.hour}:00`).join(", ")}
          </p>
        </div>
      ) : null}
      <div className="px-4 pb-3">
        <p className={xMeta}>Similar posts</p>
        <button
          type="button"
          className="cursor-pointer text-[15px] text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          disabled={query === "" || similar === SEARCHING}
          onClick={async () => {
            setSimilar(SEARCHING);
            const exit = await search({ query, mode: "top" });
            setSimilar(Exit.isFailure(exit) ? failText(exit.cause) : exit.value.items.slice(0, 3));
          }}
        >
          Find similar · {price}
        </button>
      </div>
      {typeof similar === "string" ? (
        <p className={cn(xMeta, "px-4 pb-3")}>{similar}</p>
      ) : similar !== null ? (
        <ul className="flex flex-col">
          {similar.length === 0 ? (
            <li className={cn(xMeta, "px-4 pb-3")}>Nothing similar found.</li>
          ) : null}
          {similar.map((p) => (
            <li key={p.postId} className="flex items-start gap-2 border-t border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className={xMeta}>
                  @{p.author.handle} · {p.metrics.likes} likes
                </p>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm">{p.text}</p>
              </div>
              <button
                type="button"
                className={cn(xPill, xPillSm)}
                onClick={() => onUse(splitBlocks(p.text))}
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </XCard>
  );
}

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

/** The X read voice match makes before its model call: the handle's recent posts. */
function RecentPostsPrice({ handle }: { readonly handle: string }) {
  return <>{useQuoteLabel({ kind: "userPosts", handle })} + </>;
}

/** Each action is one model call, labelled "model" as across the app; voice match also reads X. */
export function AssistPanel({
  handle,
  blocks,
  active,
  onReplaceBlock,
  onAppend,
  onReplaceAll,
}: {
  /** The Settings handle whose recent posts voice match reads; none means no read. */
  readonly handle: string | null;
  readonly blocks: ReadonlyArray<string>;
  readonly active: number;
  readonly onReplaceBlock: (index: number, text: string) => void;
  /** Adds posts after the thread's last one, whatever it is by the time Use is clicked. */
  readonly onAppend: (texts: ReadonlyArray<string>) => void;
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

  const action = (label: ReactNode, disabled: boolean, onClick: () => void, icon = false) => (
    <button
      type="button"
      className={xAction}
      disabled={busy !== null || disabled}
      onClick={onClick}
    >
      {icon ? <Sparkles /> : null}
      {label}
    </button>
  );

  return (
    <XCard title="Assist">
      <div className="-mt-1 flex flex-wrap gap-0.5 px-2.5 pb-2">
        {action(
          "Improve hook · model",
          first.trim() === "",
          () =>
            run(
              "Improve hook",
              () => hook(blocks),
              (r) => r.alternatives.map((a) => ({ text: a.text, note: a.reason, blocks: [] })),
              (s) => onReplaceBlock(0, s.text),
            ),
          true,
        )}
        {action("Rewrite · model", current.trim() === "", () =>
          run(
            `Rewrite post ${active + 1}`,
            () => rewrite(current),
            (r) => r.variants.map((text) => ({ text, blocks: [] })),
            (s) => onReplaceBlock(active, s.text),
          ),
        )}
        {action("Continue thread · model", first.trim() === "", () =>
          run(
            "Continue thread",
            () => cont(blocks),
            (r) => [{ text: r.blocks.join("\n\n"), blocks: r.blocks }],
            (s) => onAppend(s.blocks),
          ),
        )}
        {action(
          <>Voice match · {handle === null ? null : <RecentPostsPrice handle={handle} />}model</>,
          first.trim() === "",
          () =>
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
            ),
        )}
      </div>
      <form
        className="mx-4 mb-3 flex h-10 items-center rounded-full border border-border pr-1 pl-4 focus-within:border-primary"
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim() === "" || busy !== null) return;
          void run(
            "Thread ideas",
            () => ideas(topic),
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
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-placeholder"
          placeholder="Topic for thread ideas"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button
          type="submit"
          className={cn(xPill, xPillSm)}
          disabled={busy !== null || topic.trim() === ""}
        >
          Ideas · model
        </button>
      </form>
      {busy !== null ? <p className={cn(xMeta, "px-4 pb-3")}>{busy}…</p> : null}
      {error !== null ? <p className="px-4 pb-3 text-[13px] text-[#f4212e]">{error}</p> : null}
      {items.length > 0 ? (
        <div className="flex flex-col">
          <p className={cn(xMeta, "flex items-center gap-1.5 px-4 pb-2 text-primary")}>
            <Sparkles className="size-3.5" />
            {title}
          </p>
          {items.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key -- suggestions are unkeyed model output.
            <div key={i} className="border-t border-border px-4 py-3">
              <p className="whitespace-pre-wrap text-[15px] leading-5">{s.text}</p>
              {s.note !== undefined ? <p className={cn(xMeta, "mt-1")}>{s.note}</p> : null}
              {title !== "Voice match" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className={cn(xPillSolid, xPillSm)} onClick={() => use(s)}>
                    Use
                  </button>
                  <button
                    type="button"
                    className={cn(xPill, xPillSm)}
                    onClick={() => setItems(items.filter((x) => x !== s))}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </XCard>
  );
}
