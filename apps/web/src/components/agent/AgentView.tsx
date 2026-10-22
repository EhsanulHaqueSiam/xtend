import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ThreadEventRecord, ThreadId, ThreadSummary } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ArrowUp, Plus, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import {
  createThreadAtom,
  sendMessageAtom,
  threadEventsAtom,
  threadsAtom,
} from "../../state/threads";
import { PageHeader } from "../PageHeader";
import { Button } from "../ui/button";

// A turn is in flight when the latest turn marker is a start without its finish.
const isRunning = (events: ReadonlyArray<ThreadEventRecord>) =>
  events.findLast((r) => r.event.type === "turn_started" || r.event.type === "turn_finished")?.event
    .type === "turn_started";

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  readonly thread: ThreadSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] text-left text-sm text-sidebar-muted-foreground transition-colors duration-150 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        selected && "bg-sidebar-row-selected font-medium text-sidebar-foreground",
      )}
    >
      {thread.status === "running" ? (
        <span className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-primary" />
      ) : null}
      <span className="truncate">{thread.title}</span>
    </button>
  );
}

function Transcript({ events }: { readonly events: ReadonlyArray<ThreadEventRecord> }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (events.length > 0) bottom.current?.scrollIntoView({ block: "end" });
  }, [events]);
  const running = isRunning(events);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      {events.map((record) => {
        const { event } = record;
        switch (event.type) {
          case "user_message":
            return (
              <div
                key={record.sequence}
                className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap"
              >
                {event.text}
              </div>
            );
          case "assistant_text":
            return (
              <div
                key={record.sequence}
                className="max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap"
              >
                {event.text}
              </div>
            );
          case "tool_call":
            return (
              <div
                key={record.sequence}
                className="flex items-center gap-2 font-mono text-2xs text-muted-foreground"
              >
                <Wrench className="size-3" />
                <span className="text-foreground">
                  {event.toolName.replace(/^mcp__xtend__/, "")}
                </span>
                <span className="truncate">{event.input}</span>
              </div>
            );
          case "tool_result":
            return (
              <pre
                key={record.sequence}
                className={cn(
                  "max-h-40 overflow-auto rounded-md border border-border bg-code px-3 py-2 font-mono text-2xs text-muted-foreground",
                  event.isError && "border-error/40 text-error-foreground",
                )}
              >
                {event.output}
              </pre>
            );
          case "turn_finished":
            return event.ok ? null : (
              <div key={record.sequence} className="text-2xs text-error-foreground">
                Turn failed: {event.error}
              </div>
            );
          case "turn_started":
            return null;
        }
      })}
      {running ? (
        <div className="text-2xs text-muted-foreground animate-status-pulse">Thinking…</div>
      ) : null}
      <div ref={bottom} />
    </div>
  );
}

function Composer({
  threadId,
  disabled,
}: {
  readonly threadId: ThreadId;
  readonly disabled: boolean;
}) {
  const send = useAtomSet(sendMessageAtom, { mode: "promise" });
  const refreshThreads = useAtomRefresh(threadsAtom);
  const [text, setText] = useState("");
  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || disabled) return;
    setText("");
    await send({ threadId, text: trimmed });
    refreshThreads();
  };
  return (
    <div className="border-t border-border p-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-input bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="Ask about what you've seen, or what to post next…"
          className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-placeholder"
        />
        <Button
          size="icon-sm"
          aria-label="Send"
          disabled={disabled || text.trim().length === 0}
          onClick={() => void submit()}
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}

function ThreadPane({ thread }: { readonly thread: ThreadSummary }) {
  const events = useAtomValue(threadEventsAtom(thread.threadId));
  const list = AsyncResult.getOrElse(events, () => [] as ReadonlyArray<ThreadEventRecord>);
  const running = isRunning(list);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={thread.title} detail={running ? "running" : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              The assistant can read what your session observed and look at the X view. It cannot
              post.
            </p>
          </div>
        ) : (
          <Transcript events={list} />
        )}
      </div>
      <Composer threadId={thread.threadId} disabled={running} />
    </div>
  );
}

export function AgentView() {
  const threads = useAtomValue(threadsAtom);
  const refresh = useAtomRefresh(threadsAtom);
  const create = useAtomSet(createThreadAtom, { mode: "promise" });
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const list = AsyncResult.getOrElse(
    AsyncResult.map(threads, (value) => value.threads),
    () => [] as ReadonlyArray<ThreadSummary>,
  );
  const selected = list.find((t) => t.threadId === selectedId) ?? list[0];

  const newThread = async () => {
    const thread = await create(undefined);
    refresh();
    setSelectedId(thread.threadId);
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex h-(--workspace-topbar-height) shrink-0 items-center justify-between px-3">
          <span className="text-sm font-semibold tracking-tight">Agent</span>
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label="New thread"
            onClick={() => void newThread()}
          >
            <Plus />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
          {list.map((thread) => (
            <ThreadRow
              key={thread.threadId}
              thread={thread}
              selected={thread.threadId === selected?.threadId}
              onSelect={() => setSelectedId(thread.threadId)}
            />
          ))}
          {list.length === 0 && AsyncResult.isSuccess(threads) ? (
            <p className="px-2 py-4 text-2xs text-muted-foreground">No threads yet.</p>
          ) : null}
        </div>
      </aside>
      {selected === undefined ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <Button variant="outline" size="sm" onClick={() => void newThread()}>
            <Plus /> New thread
          </Button>
        </div>
      ) : (
        <ThreadPane key={selected.threadId} thread={selected} />
      )}
    </div>
  );
}
