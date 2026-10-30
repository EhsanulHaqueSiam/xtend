import { useAtom } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import { Info, PanelRight, X } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { stored, xPanelOpenAtom } from "../state/x";
import { ABOUT, isSectionRoute, sectionAbout } from "./shell/sections";
import { Button } from "./ui/button";

/** Tools whose about line the user closed; it stays closed until the ⓘ opens it again. */
const closedAtom = stored<ReadonlyArray<string>>(
  "xtend:about-closed",
  (raw) => raw.split(",").filter((r) => r !== ""),
  [],
);

export interface HeaderTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * Filters inside one section, as a segmented pill: the open one on a white
 * thumb, the rest muted. A section's own sections belong in the sidebar.
 */
export function HeaderTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  readonly tabs: ReadonlyArray<HeaderTab<T>>;
  readonly value: T;
  readonly onChange: (id: T) => void;
  /** Names the group for screen readers, e.g. "Format". */
  readonly label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      // Beside the X panel the header runs out of room: the tabs give way first and scroll, rather
      // than truncate the title or run under the actions.
      className="no-drag flex min-w-0 shrink-[100] items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-card p-0.5 [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="flex h-6 shrink-0 cursor-pointer items-baseline gap-1.5 rounded-full px-2.5 text-[12.5px] leading-6 text-muted-foreground outline-hidden transition-colors duration-150 hover:text-foreground focus-visible:text-foreground aria-selected:bg-foreground aria-selected:font-medium aria-selected:text-background"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="font-mono text-2xs tabular-nums opacity-60">
              {tab.count.toLocaleString("en")}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * What this tool and its open section do, in one line under the header. Shows
 * on the first visit to a tool, closes for good with ×, and the ⓘ by the
 * title brings it back. Routes without an entry in ABOUT get nothing.
 */
function useAbout() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const [closed, setClosed] = useAtom(closedAtom);
  // The browser's root is Seen.
  const route = pathname === "/" ? "/seen" : `/${pathname.split("/")[1] ?? ""}`;
  const tool = ABOUT[route];
  if (tool === undefined) return null;
  const tab = new URLSearchParams(searchStr).get("tab") ?? "";
  const section = isSectionRoute(route) ? sectionAbout(route, tab) : undefined;
  const open = !closed.includes(route);
  return {
    name: route.slice(1).replace(/^./, (c) => c.toUpperCase()),
    tool,
    section,
    open,
    toggle: () => setClosed(open ? [...closed, route] : closed.filter((r) => r !== route)),
  };
}

function XPanelToggle() {
  const [open, setOpen] = useAtom(xPanelOpenAtom);
  const label = open ? "Hide X panel" : "Show X panel";
  const mod = window.desktopBridge?.platform === "darwin" ? "⌘" : "Ctrl";
  return (
    <div className="no-drag shrink-0 border-l border-border pl-3">
      <Button
        variant="ghost-muted"
        size="icon-xs"
        aria-label={label}
        aria-pressed={open}
        title={`${label} (${mod}\\)`}
        onClick={() => setOpen(!open)}
      >
        <PanelRight />
      </Button>
    </div>
  );
}

/**
 * The top of every screen: 52px, the section's name (a long one truncates
 * before the actions do), an optional row of filters right after it, and the
 * screen's actions on the right. `detail` is a
 * short mono fact (a count, a date range) and never a sentence. Under it, the
 * about line while it is open.
 */
export function PageHeader({
  title,
  leading,
  tabs,
  detail,
  actions,
}: {
  readonly title: string;
  /** Before the title: a back control on a screen opened from a list. */
  readonly leading?: ReactNode;
  readonly tabs?: ReactNode;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const about = useAbout();
  return (
    <>
      <header
        className={cn(
          "flex h-(--workspace-topbar-height) shrink-0 items-center gap-5 bg-background px-6",
          isElectron && "drag-region",
        )}
      >
        {leading !== undefined ? <div className="no-drag -ml-2 shrink-0">{leading}</div> : null}
        <h1 className="min-w-0 max-w-[40%] shrink-0 truncate text-[15px] font-semibold tracking-tight">
          {title}
        </h1>
        {about === null ? null : (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            className="no-drag -ml-4"
            aria-label={`About ${about.name}`}
            aria-pressed={about.open}
            onClick={about.toggle}
          >
            <Info />
          </Button>
        )}
        {tabs}
        <div className="flex min-w-0 flex-auto items-center justify-end gap-2 overflow-x-clip">
          {detail !== undefined ? (
            // The tabs give way first: a count beside the actions must not shrink to nothing.
            <span className="max-w-64 shrink-0 truncate font-mono text-2xs text-muted-foreground tabular-nums">
              {detail}
            </span>
          ) : null}
          {actions !== undefined ? (
            <div className="no-drag flex shrink-0 items-center gap-1.5">{actions}</div>
          ) : null}
        </div>
        {isElectron ? <XPanelToggle /> : null}
      </header>
      {about !== null && about.open ? (
        // One line, no box: a first-visit guide the ⓘ brings back, not a subtitle.
        <p role="note" className="mx-6 mb-2 flex shrink-0 items-center gap-2 text-xs leading-5">
          <span
            className="min-w-0 truncate text-muted-foreground"
            title={about.section === undefined ? about.tool : `${about.tool} ${about.section}`}
          >
            <span className="text-foreground/80">{about.tool}</span>
            {about.section === undefined ? null : <span> {about.section}</span>}
          </span>
          <Button
            variant="ghost-muted"
            size="icon-tiny"
            className="ml-auto shrink-0 self-center"
            aria-label="Close"
            onClick={about.toggle}
          >
            <X />
          </Button>
        </p>
      ) : null}
    </>
  );
}
