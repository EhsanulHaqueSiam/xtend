import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Bot, CalendarClock, Gauge, Search, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { agentsAtom, paletteOpenAtom, runAgentAtom } from "../../state/shell";
import { SCREENS } from "./commands";

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

const HANDLE = /@(\w{1,15})/;

const matches = (command: Command, query: string) =>
  command.label.toLowerCase().includes(query.toLowerCase());

/**
 * The palette itself: screens, schedule, report on a handle, run an agent,
 * search the library. `go` opens a screen; `onClose` is called after a pick
 * and on Escape. Standalone wraps it in an overlay; the palette slot is it.
 */
export function PaletteBody({
  go,
  onClose,
}: {
  readonly go: (href: string) => void;
  readonly onClose: () => void;
}) {
  const agents = useAtomValue(agentsAtom);
  const runAgent = useAtomSet(runAgentAtom);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const commands = useMemo((): ReadonlyArray<Command> => {
    const to = (href: string) => () => go(href);
    const handle = HANDLE.exec(query)?.[1];
    const fixed: Array<Command> = [
      ...SCREENS.map((s) => ({ id: s.to, label: `Go to ${s.label}`, icon: s.icon, run: to(s.to) })),
      { id: "schedule", label: "Schedule this", icon: CalendarClock, run: to("/compose") },
      ...AsyncResult.getOrElse(agents, () => []).map((agent) => ({
        id: `agent:${agent.id}`,
        label: `Run agent ${agent.name}`,
        hint: "paid search",
        icon: Bot,
        run: () => runAgent(agent.id),
      })),
    ].filter((c) => matches(c, query));
    const dynamic: Array<Command> = [];
    if (handle !== undefined)
      dynamic.push({
        id: "report",
        label: `Report on @${handle}`,
        icon: Gauge,
        run: to(`/scores?handle=${encodeURIComponent(handle)}`),
      });
    if (query.trim() !== "")
      dynamic.push({
        id: "search",
        label: `Search library for "${query.trim()}"`,
        icon: Search,
        run: to(`/library?q=${encodeURIComponent(query.trim())}`),
      });
    return [...dynamic, ...fixed];
  }, [agents, go, query, runAgent]);

  // Run first: a screen command replaces the palette slot, so a close by kind afterwards is a no-op.
  const pick = (command: Command) => {
    command.run();
    onClose();
  };
  const selected = Math.min(cursor, commands.length - 1);

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="flex h-full flex-col overflow-hidden"
    >
      <input
        autoFocus
        value={query}
        placeholder="Type a command, @handle or search"
        aria-label="Command"
        className="w-full shrink-0 border-b border-border bg-transparent px-3 py-2.5 text-sm text-foreground outline-hidden placeholder:text-placeholder"
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") return onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, commands.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && commands[selected] !== undefined) {
            pick(commands[selected]);
          }
        }}
      />
      <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
        {commands.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">No commands</li>
        ) : null}
        {commands.map((command, index) => {
          const Icon = command.icon;
          return (
            <li
              key={command.id}
              role="option"
              aria-selected={index === selected}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground",
                index === selected && "bg-accent/60 text-foreground",
              )}
              onMouseEnter={() => setCursor(index)}
              onClick={() => pick(command)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{command.label}</span>
              {command.hint !== undefined ? (
                <span className="ml-auto font-mono text-2xs">{command.hint}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Standalone ⌘K: the palette as an overlay over the app. In the desktop it is the palette slot instead. */
export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  const navigate = useNavigate();
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="h-[420px] w-[520px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-background shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PaletteBody go={(href) => void navigate({ href })} onClose={close} />
      </div>
    </div>
  );
}
