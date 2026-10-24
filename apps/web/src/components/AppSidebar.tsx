import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Gauge,
  Home,
  MessageSquareReply,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Radar,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { accountsAtom, selectAccountAtom, switchAccount } from "../state/accounts";
import { connectionAtom, queuedCountAtom, spendLiveAtom } from "../state/shell";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const SIDEBAR_OPEN_KEY = "xtend:sidebar-open";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly exact?: boolean;
}

const PRIMARY: ReadonlyArray<NavItem> = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/seen", label: "Seen", icon: Radar },
];

const SUITE: ReadonlyArray<NavItem> = [
  { to: "/compose", label: "Compose", icon: PenLine },
  { to: "/plan", label: "Plan", icon: CalendarDays },
  { to: "/analyze", label: "Analyze", icon: BarChart3 },
  { to: "/engage", label: "Engage", icon: MessageSquareReply },
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/automate", label: "Automate", icon: Workflow },
  { to: "/scores", label: "Scores", icon: Gauge },
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Bottom-left strip from the spec: where the service is, what waits in the queue, what this month cost. */
function StatusStrip({ collapsed }: { readonly collapsed: boolean }) {
  const connection = useAtomValue(connectionAtom);
  const spend = useAtomValue(spendLiveAtom);
  const queued = useAtomValue(queuedCountAtom);
  const mode =
    connection === "disconnected"
      ? "offline"
      : LOCAL_HOSTS.has(window.location.hostname)
        ? "local"
        : "remote";
  const month = AsyncResult.getOrElse(
    AsyncResult.map(spend, (s) => `$${s.monthUsd.toFixed(2)}`),
    () => null,
  );
  const queue = AsyncResult.getOrElse(
    AsyncResult.map(queued, (n) => `${n} queued`),
    () => null,
  );
  return (
    <Link
      to="/settings"
      className={cn(
        "flex items-center gap-2 px-[var(--sidebar-row-content-inset)] py-1.5 font-mono text-2xs text-sidebar-muted-foreground hover:text-sidebar-foreground",
        collapsed && "justify-center px-0",
      )}
      title={`service: ${mode}${queue === null ? "" : `, ${queue}`}${month === null ? "" : `, ${month} this month`}`}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connection === "connected"
            ? "bg-success"
            : connection === "connecting"
              ? "bg-warning"
              : "bg-error",
        )}
      />
      {collapsed ? null : (
        <>
          <span className="truncate">{mode}</span>
          {queue !== null ? <span className="ml-auto shrink-0">{queue}</span> : null}
          {month !== null ? <span className="shrink-0">{month}</span> : null}
        </>
      )}
    </Link>
  );
}

/** Which X account the suite is about; switching reloads every screen on that account's data. */
function AccountSwitcher({ collapsed }: { readonly collapsed: boolean }) {
  const accounts = useAtomValue(accountsAtom);
  const select = useAtomSet(selectAccountAtom, { mode: "promise" });
  const [error, setError] = useState<string | null>(null);
  if (!AsyncResult.isSuccess(accounts) || accounts.value.accounts.length < 2) return null;
  const { accounts: list, currentId } = accounts.value;
  const current = list.find((a) => a.id === currentId) ?? list[0]!;
  // A refused select leaves the picker on the current account; say why instead of nothing.
  const change = (id: number) => {
    setError(null);
    void select(id).then(
      () => switchAccount(id),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  if (collapsed)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Account: ${current.label}. Switch to next`}
              className="no-drag mx-auto flex size-8 items-center justify-center rounded-[var(--control-radius)] font-mono text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
              onClick={() => change(list[(list.indexOf(current) + 1) % list.length]!.id)}
            />
          }
        >
          {current.label.slice(0, 1).toUpperCase()}
        </TooltipTrigger>
        <TooltipPopup side="right">{error ?? current.label}</TooltipPopup>
      </Tooltip>
    );
  return (
    <>
      <select
        aria-label="Account"
        className="no-drag h-8 w-full rounded-[var(--control-radius)] border border-sidebar-border bg-sidebar px-2 font-mono text-xs text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        value={currentId}
        onChange={(e) => change(Number(e.target.value))}
      >
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.handle !== null ? ` @${a.handle}` : ""}
          </option>
        ))}
      </select>
      {error !== null ? (
        <p role="alert" className="pt-1 text-2xs text-error-foreground">
          {error}
        </p>
      ) : null}
    </>
  );
}

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

/** T3 Code's sidebar menu row: 32px tall, icon dims to the muted mix until hover or selection. */
function NavRow({ item, collapsed }: { readonly item: NavItem; readonly collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.to}
      activeOptions={{ exact: item.exact ?? false }}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "peer/menu-button no-drag flex w-full cursor-pointer items-center gap-[var(--sidebar-control-gap)] overflow-hidden rounded-[var(--control-radius)] text-left text-sm text-sidebar-muted-foreground outline-hidden ring-ring transition-[width,height,padding,background-color,color] duration-150 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset active:bg-sidebar-row-active active:text-sidebar-foreground data-[active=true]:bg-sidebar-row-selected data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground",
        collapsed
          ? "size-8 justify-center p-0"
          : "h-8 px-[var(--sidebar-row-content-inset)] py-1.5",
      )}
    >
      <Icon />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipPopup side="right">{item.label}</TooltipPopup>
    </Tooltip>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
}: {
  readonly label?: string;
  readonly items: ReadonlyArray<NavItem>;
  readonly collapsed: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-[var(--sidebar-content-inset)]">
      {label !== undefined && !collapsed ? (
        <div className="px-[var(--sidebar-row-content-inset)] pt-3 pb-1 text-2xs font-medium tracking-wide text-sidebar-muted-foreground/70 uppercase">
          {label}
        </div>
      ) : label !== undefined ? (
        <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" />
      ) : null}
      {items.map((item) => (
        <NavRow key={item.to} item={item} collapsed={collapsed} />
      ))}
    </div>
  );
}

export function AppSidebar({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(readStoredOpen);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
    } catch {}
  }, [open]);
  const collapsed = !open;
  const ToggleIcon = open ? PanelLeftClose : PanelLeftOpen;

  return (
    <div className="flex h-full w-full bg-background">
      <aside
        data-state={open ? "expanded" : "collapsed"}
        className={cn(
          "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          open ? "w-(--sidebar-width)" : "w-(--sidebar-width-icon)",
        )}
      >
        <div
          className={cn(
            "flex h-(--workspace-topbar-height) shrink-0 items-center",
            isElectron && "drag-region",
            open
              ? "pr-2 pl-[calc(var(--desktop-window-controls-inset)+var(--sidebar-content-inset))]"
              : "justify-center",
          )}
        >
          {open ? (
            <span className="flex-1 truncate px-[var(--sidebar-row-content-inset)] text-sm font-semibold tracking-tight">
              Xtend
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="no-drag"
                  aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
                  onClick={() => setOpen((value) => !value)}
                />
              }
            >
              <ToggleIcon />
            </TooltipTrigger>
            <TooltipPopup side="right">{open ? "Collapse" : "Expand"}</TooltipPopup>
          </Tooltip>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2">
          <div className="px-[var(--sidebar-content-inset)] pb-1">
            <AccountSwitcher collapsed={collapsed} />
          </div>
          <NavGroup items={PRIMARY} collapsed={collapsed} />
          <NavGroup label="Suite" items={SUITE} collapsed={collapsed} />
        </nav>
        <div className="border-t border-sidebar-border px-[var(--sidebar-content-inset)] py-2">
          <StatusStrip collapsed={collapsed} />
          <NavRow
            item={{ to: "/settings", label: "Settings", icon: Settings }}
            collapsed={collapsed}
          />
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
