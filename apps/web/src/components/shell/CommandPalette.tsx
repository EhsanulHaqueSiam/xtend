import { Dialog } from "@base-ui/react/dialog";
import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { AtSign, Bot, Gauge, Search, SquarePen, Twitter, type LucideIcon } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useQuoteLabel, useRates } from "../../state/costs";
import { agentsAtom, peopleAtom, runAgentAtom } from "../../state/leads";
import { paletteOpenAtom } from "../../state/shell";
import { toastAtom } from "../ui/toast";
import { isXRoute, lastToolRoute, xNavigate, xPanelOpenAtom } from "../../state/x";
import { agentRunCost } from "../leads/ui";
import { SCREENS } from "./commands";
import { SECTIONS } from "./sections";

interface Command {
  readonly id: string;
  readonly group: "Actions" | "Go to" | "Sections" | "X";
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

// A whole handle only: the first 15 characters of a longer word would open someone else's report.
const HANDLE = /@(\w{1,15})\b/;

const matches = (command: Command, query: string) =>
  command.label.toLowerCase().includes(query.toLowerCase());

/** X's own pages the palette can open; on the desktop they load in the x.com webview. */
const X_PAGES: ReadonlyArray<{ readonly label: string; readonly path: string }> = [
  { label: "Home", path: "/home" },
  { label: "Notifications", path: "/notifications" },
  { label: "Messages", path: "/messages" },
  { label: "Bookmarks", path: "/i/bookmarks" },
  { label: "Explore", path: "/explore" },
  { label: "Follow", path: "/i/connect_people" },
];

/**
 * The palette itself: screens, X's pages, schedule, report on a handle, open a
 * handle on X, run an agent, search the library. `go` opens an app route;
 * `onClose` is called after a pick and on Escape.
 */
function PaletteBody({
  go,
  onClose,
  runAgent,
  running,
}: {
  readonly go: (href: string) => void;
  readonly onClose: () => void;
  readonly runAgent: (id: number) => void;
  readonly running: boolean;
}) {
  const agents = useAtomValue(agentsAtom);
  const [panelOpen, setPanel] = useAtom(xPanelOpenAtom);
  const pathname = useLocation({ select: (l) => l.pathname });
  const rates = useRates();
  const assistQuote = useQuoteLabel({ kind: "assist" });
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLUListElement>(null);

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
        id: "new-draft",
        group: "Actions" as const,
        label: "New draft",
        icon: SquarePen,
        run: to("/compose?new=true"),
      },
      ...(isElectron
        ? [
            {
              id: "x-panel",
              group: "X" as const,
              label: panelOpen && !isXRoute(pathname) ? "Hide X panel" : "Show X panel",
              icon: Twitter,
              run: () => {
                if (isXRoute(pathname)) {
                  setPanel(true);
                  go(lastToolRoute());
                } else setPanel(!panelOpen);
              },
            },
          ]
        : []),
      ...AsyncResult.getOrElse(agents, () => []).map((agent) => ({
        id: `agent:${agent.id}`,
        group: "Actions" as const,
        label: `Run agent ${agent.name}`,
        hint: `paid run ${agentRunCost(rates, assistQuote, agent)}`,
        disabled: running || rates === null || assistQuote === "…",
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
    // X's own search runs in the session, free, so on the desktop it comes first.
    if (query.trim() !== "" && isElectron)
      dynamic.push({
        id: "search-x",
        group: "X",
        label: `Search X for "${query.trim()}"`,
        icon: Search,
        run: onX(`/search?q=${encodeURIComponent(query.trim())}&src=typed_query`),
      });
    if (query.trim() !== "")
      dynamic.push({
        id: "search",
        group: "Actions",
        label: `Search library for "${query.trim()}"`,
        icon: Search,
        run: to(`/library?q=${encodeURIComponent(query.trim())}`),
      });
    return [...dynamic, ...fixed];
  }, [agents, assistQuote, go, panelOpen, pathname, query, rates, runAgent, running, setPanel]);

  const pick = (command: Command) => {
    if (command.disabled) return;
    command.run();
    onClose();
  };
  const selected = Math.min(cursor, commands.length - 1);
  // Arrow keys move past the fold once agents fill the list.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- scrolls the DOM option under the cursor into view as arrow keys move it.
  useEffect(() => {
    const options = list.current?.querySelectorAll('[role="option"]');
    options?.[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <input
        value={query}
        placeholder="Type a command, @handle or search"
        aria-label="Command"
        // Focused as it mounts: the dialog's own focus move lands a frame later, and keys typed
        // in that frame would reach the shell's letter shortcuts instead.
        autoFocus
        className="w-full shrink-0 border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-hidden placeholder:text-placeholder"
        onChange={(e) => {
          setQuery(e.target.value);
          setCursor(0);
        }}
        onKeyDown={(e) => {
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
      <ul ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
                aria-disabled={command.disabled || undefined}
                className={cn(
                  "flex h-[34px] cursor-pointer items-center gap-2.5 rounded-[var(--control-radius)] px-2.5 text-sm text-muted-foreground",
                  index === selected && "bg-white/[0.07] text-foreground",
                  command.disabled && "cursor-default opacity-40",
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
  // Remains mounted when the popup closes, keeping the screen's run atom alive.
  const runState = useAtomValue(runAgentAtom);
  const run = useAtomSet(runAgentAtom, { mode: "promise" });
  const registry = useContext(RegistryContext);
  const setToast = useAtomSet(toastAtom);
  const starting = useRef(false);
  const runAgent = (id: number) => {
    if (starting.current || runState.waiting) return;
    starting.current = true;
    setToast({ text: "Running agent" });
    void navigate({ href: "/leads?tab=agents" });
    void run(id)
      .then(
        (result) => {
          registry.refresh(agentsAtom);
          registry.refresh(peopleAtom(null));
          setToast({ text: result.error ?? "Agent finished" });
        },
        (error: unknown) =>
          setToast({ text: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        starting.current = false;
      });
  };
  const close = () => setOpen(false);
  // Where focus returns on close. The input's autoFocus lands before the dialog would note it.
  const opener = useRef<HTMLElement | null>(null);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- document focusin listener that remembers where focus returns when the palette closes.
  useEffect(() => {
    if (open) return;
    const remember = () => {
      const el = document.activeElement;
      // The opening input's focus fires before this listener goes; it is not the opener.
      if (el instanceof HTMLElement && el.closest('[role="dialog"]') === null) opener.current = el;
    };
    remember();
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Popup
          aria-label="Command palette"
          finalFocus={opener}
          className="fixed top-[12vh] left-1/2 z-50 h-[420px] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-[calc(var(--radius)+4px)] border border-white/13 bg-surface-raised"
        >
          <PaletteBody
            go={(href) => void navigate({ href })}
            onClose={close}
            runAgent={runAgent}
            running={runState.waiting}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
