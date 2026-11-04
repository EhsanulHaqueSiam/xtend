import { useAtom, useAtomSet } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Ghost,
  Lightbulb,
  PenLine,
  RotateCw,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import {
  answerText,
  type GrokAnswer,
  type GrokBlock,
  type GrokModel,
  type GrokRead,
  type GrokRun,
  grokWriteAtom,
  xGrokModels,
  xGrokPickModel,
  xGrokPress,
  xGrokSend,
} from "../../state/grok";
import { xGo, xOverAtom } from "../../state/x";
import { Menu, MenuItem } from "../ui/menu";
import { useXPress } from "./useXPress";

/**
 * X's Grok drawn by Xtend: X's top bar (model, Private, New chat), the conversation X's page
 * shows, and the box. One component for every place Grok opens. Every control is X's own, pressed
 * for the user's click; only the user's typed message is sent, with X's own Send.
 */

const ROUND =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-[#71767b] hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-40";

/** The user's click on one of X's controls: only while Settings lets the session act. */
export function useGrokPress() {
  const { blocked, setToast } = useXPress();
  const press = async <A,>(run: () => Promise<A | null>) => {
    const why = blocked();
    if (why !== null) return (setToast({ text: why }), null);
    const answer = await run();
    if (answer === null) setToast({ text: "X did not take that. Try again in a moment." });
    return answer;
  };
  return { press, setToast };
}

const X_LINK = /^https:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:\/status\/(\d{1,25}))?\/?$/;

/** One of X's inline runs: bold, italic and code as X marks them; X's profile and post links open in Xtend. */
function RunView({ run: r }: { readonly run: GrokRun }) {
  const body = (
    <span
      className={cn(
        r.bold && "font-bold",
        r.italic && "italic",
        r.code && "rounded bg-white/[0.08] px-1 font-mono text-[0.9em]",
      )}
    >
      {r.text}
    </span>
  );
  const link = "text-[#1d9bf0] hover:underline";
  if (r.href === null) return body;
  const x = X_LINK.exec(r.href);
  if (x?.[2] !== undefined)
    return (
      <Link to="/post/$id" params={{ id: x[2] }} search={{ h: x[1]! }} className={link}>
        {body}
      </Link>
    );
  if (x?.[1] !== undefined)
    return (
      <Link to="/u/$handle" params={{ handle: x[1] }} className={link}>
        {body}
      </Link>
    );
  return /^https?:\/\//.test(r.href) ? (
    <a href={r.href} target="_blank" rel="noreferrer" className={link}>
      {body}
    </a>
  ) : (
    body
  );
}

function Runs({ runs }: { readonly runs: ReadonlyArray<GrokRun> }) {
  return runs.map((r, i) => (
    // oxlint-disable-next-line react/no-array-index-key -- X's markdown has no ids; while X streams it only grows at its end.
    <RunView key={i} run={r} />
  ));
}

/**
 * X's own line in place of or under an answer (a usage limit, Stopped), its first line X's heading.
 * X's link (its upgrade page) opens in X's page, where X shows its price; any other in the browser.
 */
function Note({ note }: { readonly note: Extract<GrokBlock, { kind: "note" }> }) {
  const navigate = useNavigate();
  const [head, ...rest] = note.text.split("\n");
  const link = note.link;
  const onX = link !== null && /^https:\/\/x\.com\//.test(link.href);
  const button =
    "mt-2 inline-block cursor-pointer rounded-full bg-foreground px-3 py-1 font-bold text-background";
  return (
    <div role="status" className="rounded-2xl border border-white/[0.12] px-4 py-3 text-[13px]">
      <p className={rest.length > 0 ? "text-[15px] font-bold" : "text-[#71767b]"}>{head}</p>
      {rest.length > 0 ? (
        <p className="whitespace-pre-wrap text-[#71767b]">{rest.join("\n")}</p>
      ) : null}
      {link === null ? null : onX ? (
        <button
          type="button"
          className={button}
          onClick={() => void xGo(link.href).then(() => navigate({ to: "/x" }))}
        >
          {link.label}
        </button>
      ) : (
        <a href={link.href} target="_blank" rel="noreferrer" className={button}>
          {link.label}
        </a>
      )}
    </div>
  );
}

/** One block of X's answer, drawn as X's markdown draws it. */
function Block({ block }: { readonly block: GrokBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="whitespace-pre-wrap">
          <Runs runs={block.runs} />
        </p>
      );
    case "h":
      return (
        <p className={cn("font-bold", block.level <= 2 ? "text-[19px]" : "text-[17px]")}>
          <Runs runs={block.runs} />
        </p>
      );
    case "li":
      return (
        <p className="flex gap-2" style={{ paddingLeft: 4 + block.depth * 20 }}>
          <span className="text-[#71767b]">{block.ordered ? "–" : "•"}</span>
          <span className="min-w-0">
            <Runs runs={block.runs} />
          </span>
        </p>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-white/[0.2] pl-3 text-[#c4c7ca]">
          <Runs runs={block.runs} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl bg-white/[0.06] p-3 font-mono text-[13px] leading-5">
          {block.text}
        </pre>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="text-[14px]">
            <tbody>
              {block.rows.map((row, r) => (
                // oxlint-disable-next-line react/no-array-index-key -- as for runs: X's table has no ids.
                <tr key={r} className="border-b border-white/[0.12]">
                  {row.map((cell, c) => (
                    // oxlint-disable-next-line react/no-array-index-key -- as above.
                    <td key={c} className={cn("px-2 py-1.5", r === 0 && block.head && "font-bold")}>
                      <Runs runs={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr className="border-white/[0.12]" />;
    case "img":
      return <img src={block.src} alt={block.alt} className="max-h-[420px] rounded-xl" />;
    case "note":
      return <Note note={block} />;
  }
}

/** X's answer: its thinking line, its markdown, its sources, and X's actions once it is done. */
function Answer({
  answer,
  latest,
  onDraft,
}: {
  readonly answer: GrokAnswer;
  readonly latest: boolean;
  readonly onDraft?: ((text: string) => void) | undefined;
}) {
  const { press, setToast } = useGrokPress();
  const text = answerText(answer);
  return (
    <div data-x="grok-answer" className="flex flex-col gap-3 text-[15px] leading-relaxed">
      {answer.trace === null ? null : (
        <p className="flex items-center gap-1.5 text-[15px] text-[#71767b]">
          <Lightbulb className="size-4" />
          {answer.trace}
        </p>
      )}
      {answer.blocks.map((b, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- as for runs: X's blocks have no ids.
        <Block key={i} block={b} />
      ))}
      {answer.sources === null ? null : (
        <span className="w-fit rounded-full bg-white/[0.08] px-3 py-1 text-[13px] text-[#71767b]">
          {answer.sources}
        </span>
      )}
      {answer.done ? (
        <div className="-ml-1.5 flex items-center gap-0.5">
          {latest ? (
            <button
              type="button"
              aria-label="Regenerate"
              disabled={!answer.regenerate}
              className={ROUND}
              onClick={() => void press(() => xGrokPress("regenerate", answer.id))}
            >
              <RotateCw className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Copy"
            className={ROUND}
            onClick={() =>
              void navigator.clipboard
                .writeText(text)
                .then(() => setToast({ text: "Copied to clipboard" }))
            }
          >
            <Copy className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Good response"
            aria-pressed={answer.feedback === "up"}
            className={cn(ROUND, "aria-pressed:text-foreground")}
            onClick={() => void press(() => xGrokPress("up", answer.id))}
          >
            <ThumbsUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Bad response"
            aria-pressed={answer.feedback === "down"}
            className={cn(ROUND, "aria-pressed:text-foreground")}
            onClick={() => void press(() => xGrokPress("down", answer.id))}
          >
            <ThumbsDown className="size-4" />
          </button>
          {onDraft === undefined || text === "" ? null : (
            <button
              type="button"
              className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.18] px-3 text-[13px] font-bold hover:bg-white/[0.06]"
              onClick={() => onDraft(text)}
            >
              <PenLine className="size-3.5" />
              Draft a post
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** X's model menu, read from X's own when it opens: X's list, X's pick, X's upgrade rows. */
function ModelMenu({ model }: { readonly model: string | null }) {
  const setOver = useAtomSet(xOverAtom);
  const { press } = useGrokPress();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof xGrokModels>> | undefined>(undefined);
  const pick = (row: GrokModel) => void press(() => xGrokPickModel(row.title, setOver));
  return (
    <Menu
      label="Models"
      onOpenChange={(open) => {
        if (!open) return;
        setRows(undefined);
        void xGrokModels().then(setRows);
      }}
      trigger={
        <button
          type="button"
          className="no-drag flex h-8 cursor-pointer items-center gap-1 rounded-full px-3 text-[15px] font-bold hover:bg-white/[0.06]"
        >
          {model ?? "Grok"}
          <ChevronDown className="size-4 text-[#71767b]" />
        </button>
      }
    >
      {rows === undefined || rows === null ? (
        <MenuItem disabled onClick={() => {}}>
          {rows === undefined ? "Loading from X" : "X shows no models here now."}
        </MenuItem>
      ) : "failed" in rows ? (
        <MenuItem onClick={() => void xGrokModels().then(setRows)}>{rows.failed}</MenuItem>
      ) : (
        rows.map((row) => (
          <MenuItem key={row.title} disabled={row.state === "disabled"} onClick={() => pick(row)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-foreground">
                {row.title}
                {row.badge === null ? null : <span className="text-[#71767b]"> • {row.badge}</span>}
              </span>
              {row.description === null ? null : (
                <span className="text-[12px] text-[#71767b]">{row.description}</span>
              )}
            </span>
            {row.state === "selected" ? <Check className="size-4 text-[#1d9bf0]" /> : null}
            {row.state === "upgrade" ? (
              <span className="text-[12px] text-[#1d9bf0]">Upgrade</span>
            ) : null}
          </MenuItem>
        ))
      )}
    </Menu>
  );
}

/**
 * X's top bar on its Grok page: the model, then Private on a new chat or New chat in one. New chat
 * ends a send X never showed, keeping its words in the box; `onNew` follows X there.
 */
export function GrokBar({
  read,
  onNew,
  children,
}: {
  readonly read: GrokRead;
  readonly onNew?: () => void;
  readonly children?: ReactNode;
}) {
  const setWrite = useAtomSet(grokWriteAtom);
  const { press } = useGrokPress();
  return (
    <div className="drag-region flex min-h-[53px] items-center gap-1 px-3">
      <ModelMenu model={read.model} />
      <span className="flex-1" />
      {read.private === null ? null : (
        <button
          type="button"
          aria-pressed={read.private}
          className="no-drag flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-bold text-[#71767b] hover:bg-white/[0.06] aria-pressed:bg-white aria-pressed:text-black"
          onClick={() => void press(() => xGrokPress("private"))}
        >
          <Ghost className="size-4" />
          Private
        </button>
      )}
      {read.conversation ? (
        <button
          type="button"
          aria-label="New chat"
          className={cn("no-drag", ROUND)}
          onClick={() =>
            void press(() => xGrokPress("new")).then((done) => {
              if (done === null) return;
              setWrite((w) => ({ ...w, send: null }));
              onNew?.();
            })
          }
        >
          <SquarePen className="size-[18px]" />
        </button>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Grok's box: the user's words go to X's own composer and Send only on Send, and stay until X
 * shows them asked. Stop and X's Quick Answer or Think Harder chip are X's while it answers.
 */
export function GrokBox({ read }: { readonly read: GrokRead }) {
  const [write, setWrite] = useAtom(grokWriteAtom);
  const { press, setToast } = useGrokPress();
  const composer = read.composer;
  const busy = composer?.busy === true;
  const submit = async () => {
    const text = write.draft;
    if (text.trim() === "" || write.send !== null || composer === null || busy) return;
    const before = (read.turns ?? []).map((t) => t.id);
    setWrite((w) => ({ ...w, send: { text, path: read.path, before, alert: read.alert } }));
    const sent = await press(() => xGrokSend(read.path, text));
    // Pending: X still sends it, and the page's next reads settle it (`sendSettled`).
    if (sent?.status === "pending") return;
    setWrite((w) => ({ draft: sent?.status === "sent" ? "" : w.draft, send: null }));
    if (sent?.status === "draft") setToast({ text: "X's Grok box holds a draft; finish it in X." });
    if (sent?.status === "busy") setToast({ text: "Grok is still answering." });
  };
  return (
    <div className="px-4 pt-2 pb-4">
      {composer?.steer == null ? null : (
        <button
          type="button"
          className="mb-2 ml-2 flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.18] px-3 text-[13px] text-[#71767b] hover:text-foreground"
          onClick={() => void press(() => xGrokPress("steer"))}
        >
          {composer.steer === "harder" ? (
            <Lightbulb className="size-4 text-purple-400" />
          ) : (
            <Zap className="size-4 text-[#ffd400]" />
          )}
          {composer.steer === "harder" ? "Think Harder" : "Quick Answer"}
        </button>
      )}
      <div className="flex items-end gap-2 rounded-3xl border border-white/[0.16] bg-black py-2 pr-2 pl-4 focus-within:border-white/[0.32]">
        <textarea
          aria-label="Ask Grok"
          placeholder={composer?.placeholder || "Ask anything"}
          rows={1}
          value={write.draft}
          disabled={write.send !== null || composer === null || composer.disabled}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-hidden [field-sizing:content] placeholder:text-[#71767b]"
          onChange={(e) => setWrite((w) => ({ ...w, draft: e.target.value }))}
          onKeyDown={(e) => {
            // X's Enter sends and Shift+Enter starts a line.
            if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
        {busy ? (
          <button
            type="button"
            aria-label="Stop"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background"
            onClick={() => void press(() => xGrokPress("stop"))}
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={write.draft.trim() === "" || write.send !== null || composer === null}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background disabled:cursor-default disabled:opacity-40"
            onClick={() => void submit()}
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      {read.private === true ? (
        <p className="mt-2 px-2 text-[13px] text-[#71767b]">
          Private chat: this chat won't appear in your history, and Xtend keeps nothing from it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * X's conversation as X's page shows it: the user's questions on the right, X's answers under
 * them, and X's follow-ups, which fill the box for the user to send.
 */
export function GrokConversation({ read }: { readonly read: GrokRead }) {
  const navigate = useNavigate();
  const setWrite = useAtomSet(grokWriteAtom);
  const turns = read.turns ?? [];
  const last = turns.findLast((t) => t.answer !== null)?.answer?.id;
  const draft = (text: string) =>
    void navigate({ href: `/compose?${new URLSearchParams({ text }).toString()}` });
  if (turns.length === 0)
    return (
      <div className="m-auto max-w-[420px] px-6 text-center">
        <h2 className="text-[31px] leading-9 font-extrabold">Grok</h2>
        <p className="mt-2 text-[15px] text-[#71767b]">
          Ask anything. Grok runs on your X account, free within X's limits.
        </p>
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 py-6">
      {turns.map((turn) => (
        <div key={turn.id} data-x="grok-turn" className="flex flex-col gap-4">
          {turn.user === null ? null : (
            <p className="max-w-[80%] self-end rounded-3xl bg-[#202327] px-4 py-2.5 text-[15px] whitespace-pre-wrap">
              {turn.user}
            </p>
          )}
          {turn.answer === null ? null : (
            <Answer
              answer={turn.answer}
              latest={turn.answer.id === last}
              onDraft={read.private === true ? undefined : draft}
            />
          )}
        </div>
      ))}
      {read.followUps.length === 0 || read.composer?.busy ? null : (
        <div className="-ml-1 flex flex-col gap-1">
          {read.followUps.map((f) => (
            <button
              key={f}
              type="button"
              className="flex cursor-pointer items-center gap-2 rounded-full px-2 py-1 text-left text-[15px] text-[#71767b] hover:text-foreground"
              onClick={() => setWrite((w) => (w.send === null ? { ...w, draft: f } : w))}
            >
              <ArrowUp className="size-4" />
              {f}
            </button>
          ))}
        </div>
      )}
      {read.alert === null ? null : (
        <p role="alert" className="text-[14px] text-[#f4212e]">
          {read.alert}
        </p>
      )}
    </div>
  );
}
