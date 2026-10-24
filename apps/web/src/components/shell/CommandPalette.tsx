import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { AtSign, Bot, CalendarClock, Gauge, Search, Twitter, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { agentsAtom, paletteOpenAtom, runAgentAtom } from "../../state/shell";
import { xNavigate } from "../../state/x";
import { SCREENS } from "./commands";
import { SECTIONS } from "./sections";

interface Command {
  readonly id: string;
  readonly group: "Actions" | "Go to" | "Sections" | "X";
  readonly label: string;
  readonly hint?: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

const HANDLE = /@(\w{1,15})/;

const matches = (command: Command, query: string) =>
  command.label.toLowerCase().includes(query.toLowerCase());

/** X's own pages the palette can open; on the desktop they load in the x.com webview. */
const X_PAGES: ReadonlyArray<{ readonly label: string; readonly path: string }> = [
  { label: "Home", path: "/home" },
  { label: "Notifications", path: "/notifications" },
  { label: "Messages", path: "/messages" },
  { label: "Bookmarks", path: "/i/bookmarks" },
  { label: "Explore", path: "/explore" },
];

/**
 * The palette itself: screens, X's pages, schedule, report on a handle, open a
 * handle on X, run an agent, search the library. `go` opens an app route;
 * `onClose` is called after a pick and on Escape.
 */
function PaletteBody({
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
    const onX = (path: string) => () => {
      xNavigate(`https://x.com${path}`);
      go("/x");
    };
    const handle = HANDLE.exec(query)?.[1];
    const fixed: Array<Command> = [
      ...SCREENS.map((s) => ({
        id: s.to,
        group: "Go to" as const,
        label: s.label,
        icon: s.icon,
        run: to(s.to),
      })),
      ...(isElectron
        ? X_PAGES.map((p) => ({
            id: `x:${p.path}`,
            group: "X" as const,
            label: p.label,
            icon: Twitter,
            run: onX(p.path),
          }))
        : []),
      // Sections only once something is typed, so the empty palette stays short.
      ...(query.trim() === ""
        ? []
        : SCREENS.flatMap((screen) =>
            screen.to in SECTIONS
              ? SECTIONS[screen.to as keyof typeof SECTIONS].map((section) => ({
                  id: `${screen.to}?tab=${section.id}`,
                  group: "Sections" as const,
                  label: `${screen.label}: ${section.label}`,
                  icon: screen.icon,
                  run: to(`${screen.to}?tab=${section.id}`),
                }))
              : [],
          )),
      {
        id: "schedule",
        group: "Actions" as const,
        label: "Schedule this",
        icon: CalendarClock,
        run: to("/compose"),
      },
      ...AsyncResult.getOrElse(agents, () => []).map((agent) => ({
        id: `agent:${agent.id}`,
        group: "Actions" as const,
        label: `Run agent ${agent.name}`,
        hint: "paid search",
        icon: Bot,
        run: () => runAgent(agent.id),
      })),
    ].filter((c) => matches(c, query));
    const dynamic: Array<Command> = [];
    if (handle !== undefined) {
      dynamic.push({
        id: "report",
        group: "Actions",
        label: `Report on @${handle}`,
        icon: Gauge,
        run: to(`/scores?handle=${encodeURIComponent(handle)}`),
      });
      if (isElectron)
        dynamic.push({
          id: "profile",
          group: "X",
          label: `Open @${handle} on X`,
          icon: AtSign,
          run: onX(`/${handle}`),
        });
    }
    if (query.trim() !== "")
      dynamic.push({
        id: "search",
        group: "Actions",
        label: `Search library for "${query.trim()}"`,
        icon: Search,
        run: to(`/library?q=${encodeURIComponent(query.trim())}`),
      });
    return [...dynamic, ...fixed];
  }, [agents, go, query, runAgent]);

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
        className="w-full shrink-0 border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-hidden placeholder:text-placeholder"
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
      <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {commands.length === 0 ? (
          <li className="px-2.5 py-2 text-xs text-muted-foreground">No commands</li>
        ) : null}
        {commands.map((command, index) => {
          const Icon = command.icon;
          // A group's name goes above its first command; the list keeps its order.
          const heading = index === 0 || commands[index - 1]?.group !== command.group;
          return (
            <li key={command.id} role="presentation">
              {heading ? (
                <div className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">
                  {command.group}
                </div>
              ) : null}
              <div
                role="option"
                aria-selected={index === selected}
                className={cn(
                  "flex h-[34px] cursor-pointer items-center gap-2.5 rounded-[var(--control-radius)] px-2.5 text-sm text-muted-foreground",
                  index === selected && "bg-white/[0.07] text-foreground",
                )}
                onMouseEnter={() => setCursor(index)}
                onClick={() => pick(command)}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{command.label}</span>
                {command.hint !== undefined ? (
                  <span className="ml-auto font-mono text-2xs text-muted-foreground">
                    {command.hint}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * ⌘K: the palette over everything, x.com included. It opens with no animation: a key
 * pressed hundreds of times a day should answer at once.
 */
export function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom);
  const navigate = useNavigate();
  if (!open) return null;
  const close = () => setOpen(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        className="h-[420px] w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[calc(var(--radius)+4px)] border border-white/13 bg-surface-raised"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PaletteBody go={(href) => void navigate({ href })} onClose={close} />
      </div>
    </div>
  );
}
