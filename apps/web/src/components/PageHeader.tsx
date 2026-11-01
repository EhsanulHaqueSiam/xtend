import { useAtom } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import { Info, PanelRight, X } from "lucide-react";
import type { ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { stored, xPanelOpenAtom } from "../state/x";
import { ABOUT, isSectionRoute, sectionAbout } from "./shell/sections";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

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
 * Filters inside one section, as plain words: the open one on a faint thumb,
 * the rest muted. A section's own sections belong in the sidebar.
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
      // Sized from zero up to their content: they take the room the actions leave and scroll in
      // less, and the header's wrapping never counts them, so they never push the actions down.
      className="no-drag flex max-w-fit min-w-0 flex-1 basis-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="flex h-7 shrink-0 cursor-pointer items-baseline gap-1.5 rounded-[calc(var(--control-radius)-1px)] px-2.5 text-[12.5px] leading-7 text-muted-foreground outline-hidden transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-selected:bg-white/10 aria-selected:font-medium aria-selected:text-foreground"
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
  // The browser's root is Today.
  const route = pathname === "/" ? "/today" : `/${pathname.split("/")[1] ?? ""}`;
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
    <div className="no-drag ml-3 shrink-0 border-l border-border pl-3">
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
 * The top of every screen: the section's name (truncating before the actions do), optional
 * filters after it, actions on the right, and the about line under it while open. `detail` is a
 * short mono fact (a count, a date range), never a sentence.
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
          // Beside the X panel, actions that do not fit beside the title wrap onto a second row.
          "flex min-h-(--workspace-topbar-height) shrink-0 flex-wrap content-center items-center gap-x-5 gap-y-2 bg-background px-6 py-2",
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
        {/* One block with the X panel toggle, so a wrap moves them together and the toggle stays last.
            Too wide even on a row of its own, the actions wrap among themselves and the detail
            truncates: every control stays in view beside the X panel. */}
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
          {detail !== undefined ? (
            <span className="max-w-64 min-w-0 truncate font-mono text-2xs text-muted-foreground tabular-nums">
              {detail}
            </span>
          ) : null}
          {actions !== undefined ? (
            <div className="no-drag flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5">
              {actions}
            </div>
          ) : null}
          {isElectron ? <XPanelToggle /> : null}
        </div>
      </header>
      {about !== null && about.open ? (
        // One line, no box: a first-visit guide the ⓘ brings back, not a subtitle.
        <p role="note" className="mx-6 mb-2 flex shrink-0 items-center gap-2 text-xs leading-5">
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate text-muted-foreground" />}>
              <span className="text-foreground/80">{about.tool}</span>
              {about.section === undefined ? null : <span> {about.section}</span>}
            </TooltipTrigger>
            <TooltipPopup>
              {about.section === undefined ? about.tool : `${about.tool} ${about.section}`}
            </TooltipPopup>
          </Tooltip>
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
