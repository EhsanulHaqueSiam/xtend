import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  ChevronDown,
  CircleCheck,
  Download,
  RefreshCw,
  Search,
  Home,
  Bell,
  Mail,
  Bookmark,
  Compass,
  UserRound,
  PenLine,
  CalendarDays,
  Library,
  List as ListIcon,
  MessageCircle,
  Users,
  Workflow,
  ChartNoAxesCombined,
  Gauge,
  Settings,
  Sun,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { carriesLink, postFromTransfer } from "../../lib/drag";
import { nextScheduledLabel } from "../../lib/glance";
import { cn } from "../../lib/utils";
import { accountsAtom, selectAccountAtom, switchAccount } from "../../state/accounts";
import { pendingAtom } from "../../state/automate";
import { inboxItemsAtom } from "../../state/engage";
import { settingsAtom } from "../../state/settings";
import { useDesktopUpdate } from "../../state/update";
import {
  connectionAtom,
  paletteOpenAtom,
  queuedDraftsAtom,
  spendLiveAtom,
} from "../../state/shell";
import {
  xNavigate,
  xPanelOpenAtom,
  xPanelPinnedAtom,
  stored,
  xReload,
  xUnreadAtom,
  xUrlAtom,
} from "../../state/x";
import { Menu, MenuItem } from "../ui/menu";
import { toastAtom } from "../ui/toast";
import { DROP_VERBS, linkDragAtom, useDropPost } from "./drops";
import { ABOUT, isSectionRoute, SECTIONS } from "./sections";

const or = <A, B>(result: AsyncResult.AsyncResult<A, unknown>, fallback: B): A | B =>
  AsyncResult.getOrElse(result, () => fallback);

const ROW =
  "no-drag flex h-[28px] w-full cursor-pointer items-center gap-2.5 rounded-[var(--control-radius)] px-2 text-left text-sm text-sidebar-muted-foreground outline-hidden transition-colors duration-150 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-active data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[open=true]:text-sidebar-foreground";

/**
 * Icon, label and an optional count: the one row shape in the sidebar. A `hot`
 * count waits on the user and shows solid. While a post is being dragged, a row
 * that accepts it shows its verb instead.
 */
const ICONS = {
  Home,
  Explore: Compass,
  Notifications: Bell,
  Messages: Mail,
  Bookmarks: Bookmark,
  Lists: ListIcon,
  Profile: UserRound,
  Compose: PenLine,
  Plan: CalendarDays,
  Library,
  Engage: MessageCircle,
  Leads: Users,
  Automate: Workflow,
  Analyze: ChartNoAxesCombined,
  Scores: Gauge,
  Settings,
  Today: Sun,
};

function RowBody({
  label,
  count,
  hot = false,
  verb,
  compact = false,
}: {
  readonly label: string;
  readonly count?: number | null | undefined;
  readonly hot?: boolean;
  readonly verb?: string | undefined;
  readonly compact?: boolean;
}) {
  const Icon = ICONS[label as keyof typeof ICONS];
  if (compact && Icon !== undefined)
    return <Icon aria-hidden="true" className="mx-auto size-4 shrink-0" />;
  return (
    <>
      {Icon !== undefined ? (
        <Icon
          aria-hidden="true"
          className="size-4 shrink-0 text-(--sidebar-icon-color) in-data-[active=true]:text-sidebar-foreground in-data-[open=true]:text-sidebar-foreground"
        />
      ) : null}
      <span className="truncate">{label}</span>
      {verb !== undefined ? (
        <span className="ml-auto text-2xs text-sidebar-muted-foreground">{verb}</span>
      ) : count !== undefined && count !== null && count > 0 ? (
        <span
          className={cn(
            "ml-auto rounded-[5px] px-1.5 font-mono text-2xs leading-[18px] tabular-nums",
            hot ? "bg-sidebar-foreground text-sidebar" : "bg-white/8 text-sidebar-foreground/80",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
}

interface Tool {
  readonly to: string;
  readonly label: string;
  /** Starts a group: the label shows above this tool. */
  readonly group?: string;
}

const TOOLS: ReadonlyArray<Tool> = [
  { to: "/today", label: "Today" },
  { to: "/compose", label: "Compose", group: "Create" },
  { to: "/plan", label: "Plan" },
  { to: "/library", label: "Library" },
  { to: "/engage", label: "Engage", group: "Grow" },
  { to: "/leads", label: "Leads" },
  { to: "/automate", label: "Automate" },
  { to: "/analyze", label: "Analyze", group: "Measure" },
  { to: "/scores", label: "Scores" },
];

const isOn = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

/** While a link drag is in flight, rows that take a post stand out and the rest fade. */
const dragClass = (dragging: boolean, target: boolean) =>
  dragging ? (target ? "ring-1 ring-sidebar-row-active ring-inset" : "opacity-30") : undefined;

const SUB_ROW =
  "no-drag flex h-[25px] w-full cursor-pointer items-center rounded-[var(--control-radius)] pr-2 pl-[34px] text-left text-[13px] text-sidebar-muted-foreground outline-hidden transition-colors duration-150 hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-active data-[active=true]:text-sidebar-foreground";

/** A tool, and under it while it is open, its sections: the page has no tab row of its own. */
function ToolRow({
  tool,
  count,
  hot = false,
  compact = false,
}: {
  readonly compact?: boolean;
  readonly tool: Tool;
  readonly count?: number | null | undefined;
  readonly hot?: boolean;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const on = isOn(pathname, tool.to);
  const sections: ReadonlyArray<{ readonly id: string; readonly label: string }> =
    on && isSectionRoute(tool.to) ? SECTIONS[tool.to] : [];
  const tab = new URLSearchParams(searchStr).get("tab");
  const openId = sections.find((s) => s.id === tab)?.id ?? sections[0]?.id;
  const dragging = useAtomValue(linkDragAtom);
  const setDragging = useAtomSet(linkDragAtom);
  const setToast = useAtomSet(toastAtom);
  const drop = useDropPost();
  const verb = DROP_VERBS[tool.to];
  return (
    <>
      {tool.group !== undefined && !compact ? (
        <div className="px-2 pt-4 pb-1 text-3xs font-medium tracking-[0.08em] text-sidebar-muted-foreground/70 uppercase">
          {tool.group}
        </div>
      ) : null}
      <Link
        to={tool.to}
        title={compact ? tool.label : ABOUT[tool.to]}
        aria-label={compact ? tool.label : undefined}
        data-active={on && (compact || sections.length === 0)}
        data-open={on}
        className={cn(ROW, dragClass(dragging, verb !== undefined))}
        onDragOver={
          verb === undefined
            ? undefined
            : (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
        }
        onDrop={
          verb === undefined
            ? undefined
            : (event) => {
                event.preventDefault();
                setDragging(false);
                const post = postFromTransfer(event.dataTransfer);
                if (post === null) setToast({ text: "Not an X post" });
                else drop(tool.to, post);
              }
        }
      >
        <RowBody
          label={tool.label}
          count={count}
          hot={hot}
          verb={dragging ? verb : undefined}
          compact={compact}
        />
      </Link>
      {compact && sections.length > 0 ? (
        <Menu
          label={`${tool.label} sections`}
          trigger={
            <button
              type="button"
              aria-label={`${tool.label} sections`}
              title={`${tool.label} sections`}
              className={ROW}
            >
              <ChevronDown className="mx-auto size-3" />
            </button>
          }
        >
          {sections.map((section) => (
            <MenuItem
              key={section.id}
              onClick={() => void navigate({ href: `${tool.to}?tab=${section.id}` })}
            >
              {section.label}
            </MenuItem>
          ))}
        </Menu>
      ) : null}
      {(compact ? [] : sections).map((section) => {
        const href = `${tool.to}?tab=${section.id}`;
        return (
          <a
            key={section.id}
            href={router.history.createHref(href)}
            data-active={section.id === openId}
            className={cn(SUB_ROW, dragClass(dragging, false))}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              void navigate({ href });
            }}
          >
            <RowBody
              label={section.label}
              count={tool.to === "/automate" && section.id === "needs-you" ? count : undefined}
              hot={hot}
            />
          </a>
        );
      })}
    </>
  );
}

/** X pages Xtend draws itself; the rest (Messages) still show x.com in the main area. */
const NATIVE: Readonly<Record<string, string>> = {
  Home: "/home",
  Explore: "/explore",
  Notifications: "/notifications",
  Bookmarks: "/bookmarks",
  Lists: "/lists",
};

/** X's own pages; each loads in the one x.com webview, shown in the main area. */
function XRows({ compact }: { readonly compact: boolean }) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const url = useAtomValue(xUrlAtom);
  const unread = useAtomValue(xUnreadAtom);
  const handle = or(
    AsyncResult.map(useAtomValue(settingsAtom), (s) => s.handle),
    null,
  );
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {}
  const onX = pathname === "/x";
  const dragging = useAtomValue(linkDragAtom);
  const pinned = useAtomValue(xPanelPinnedAtom);
  const [panelOpen, setPanel] = useAtom(xPanelOpenAtom);
  const pages: ReadonlyArray<{ label: string; path: string; count?: number }> = [
    { label: "Home", path: "/home" },
    { label: "Explore", path: "/explore" },
    { label: "Notifications", path: "/notifications", count: unread },
    { label: "Messages", path: "/messages" },
    { label: "Bookmarks", path: "/i/bookmarks" },
    { label: "Lists", path: "/i/lists" },
    ...(handle === null ? [] : [{ label: "Profile", path: `/${handle}` }]),
  ];
  return (
    <>
      {pages.map((page) => (
        <button
          key={page.label}
          aria-label={compact ? page.label : undefined}
          title={compact ? page.label : undefined}
          type="button"
          data-active={
            page.label === "Profile"
              ? pathname === `/u/${handle}`
              : NATIVE[page.label] !== undefined
                ? pathname === NATIVE[page.label] || pathname.startsWith(`${NATIVE[page.label]}/`)
                : onX && (path === page.path || path.startsWith(`${page.path}/`))
          }
          className={cn(ROW, dragClass(dragging, false))}
          onClick={() => {
            // Xtend draws these itself; the engine follows them off screen.
            const native = page.label === "Profile" ? `/u/${handle}` : NATIVE[page.label];
            if (native !== undefined) return void navigate({ href: native });
            // A page already in the webview is only revealed; clicked again where it shows, it
            // reloads, like X's own Home.
            if (path !== page.path) xNavigate(`https://x.com${page.path}`);
            else if (onX || (pinned && panelOpen)) xReload();
            // Pinned beside a tool, X's pages open in the panel and the tool stays.
            if (pinned && !onX) setPanel(true);
            else void navigate({ to: "/x" });
          }}
        >
          <RowBody label={page.label} count={page.count} compact={compact} />
        </button>
      ))}
    </>
  );
}

/**
 * The current account; with more than one, a menu that rebuilds the window on another. A refused
 * switch (a post going out, a removed account) goes to `onError`, so the sidebar can say why.
 */
function AccountMenu({
  onError,
  compact = false,
}: {
  readonly onError: (message: string | null) => void;
  readonly compact?: boolean;
}) {
  const accounts = useAtomValue(accountsAtom);
  const select = useAtomSet(selectAccountAtom, { mode: "promise" });
  const handle = or(
    AsyncResult.map(useAtomValue(settingsAtom), (s) => s.handle),
    null,
  );
  const list = AsyncResult.isSuccess(accounts) ? accounts.value.accounts : [];
  const currentId = AsyncResult.isSuccess(accounts) ? accounts.value.currentId : null;
  const current = list.find((a) => a.id === currentId);
  const label = current?.handle ?? handle;
  if (list.length < 2)
    return compact || label === null || label === undefined ? null : (
      <span className="truncate text-xs text-sidebar-muted-foreground">@{label}</span>
    );
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Switch account"
          title="Switch account"
          className="no-drag flex cursor-pointer items-center gap-1 rounded-[var(--control-radius)] px-1.5 py-0.5 text-xs text-sidebar-muted-foreground outline-hidden hover:text-sidebar-foreground"
        >
          {compact ? (
            <UserRound className="size-4" />
          ) : label === null || label === undefined ? (
            (current?.label ?? "Account")
          ) : (
            `@${label}`
          )}
          <ChevronDown className="size-3" />
        </button>
      }
    >
      {list.map((a) => (
        <MenuItem
          key={a.id}
          onClick={() => {
            onError(null);
            void select(a.id).then(
              () => switchAccount(a.id),
              (e: unknown) => onError(e instanceof Error ? e.message : String(e)),
            );
          }}
        >
          <span className="truncate">{a.label}</span>
          {a.handle !== null ? (
            <span className="ml-auto font-mono text-2xs">@{a.handle}</span>
          ) : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** The time, refreshed every minute: labels such as "Today 09:30" turn into "Tomorrow" on their own. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The version this window last ran, so the first launch after an update can say so. */
const seenVersionAtom = stored<string>("xtend:seen-version", (raw) => raw, "");

/**
 * The desktop's update as one icon beside the account, as in T3 Code: ↻ checks now, a download
 * with a dot means a build is on its way or ready (a click restarts into it, or opens the
 * download on an unsigned macOS build), and "Updated" says once that this launch is new.
 */
function UpdateButton() {
  const update = useDesktopUpdate();
  const [seen, setSeen] = useAtom(seenVersionAtom);
  if (update === null) return null;
  const fresh = seen !== "" && seen !== update.version;
  const icon = "size-3.5";
  const button = (label: string, run: () => void, body: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="no-drag relative grid size-6 cursor-pointer place-items-center rounded-md text-sidebar-muted-foreground outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={run}
    >
      {body}
    </button>
  );
  const dot = (
    <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-sidebar-foreground" />
  );
  if (update.status === "ready")
    return button(
      `Restart to update to ${update.next}`,
      () => window.desktopBridge?.restartToUpdate(),
      <>
        <Download className={icon} />
        {dot}
      </>,
    );
  if (update.status === "available")
    return button(
      `Download ${update.next}`,
      () => window.desktopBridge?.openExternal(update.url),
      <>
        <Download className={icon} />
        {dot}
      </>,
    );
  if (update.status === "downloading")
    return button(
      `Downloading ${update.next}, ${update.percent}%`,
      () => {},
      <Download className={icon} />,
    );
  if (fresh)
    return (
      <button
        type="button"
        title={`Updated to ${update.version}`}
        className="no-drag flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-2xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        onClick={() => setSeen(update.version)}
      >
        Updated
        <CircleCheck className={icon} />
      </button>
    );
  return button(
    update.status === "error"
      ? `Update check failed: ${update.message}. Check again`
      : "Check for updates",
    () => {
      setSeen(update.version);
      window.desktopBridge?.checkUpdate();
    },
    <RefreshCw className={icon} />,
  );
}

/** The day at a glance, all from free reads: next post, queue, spend against budget, service. */
function Today() {
  const queued = or(useAtomValue(queuedDraftsAtom), null);
  const spend = or(useAtomValue(spendLiveAtom), null);
  const settings = or(useAtomValue(settingsAtom), null);
  const connection = useAtomValue(connectionAtom);
  const zone = settings?.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = useMinuteClock();
  const next = queued === null ? null : nextScheduledLabel(queued, zone, now);
  const mode =
    connection === "disconnected"
      ? "offline"
      : window.desktopBridge?.serviceMode === "remote" ||
          (!isElectron && !LOCAL_HOSTS.has(window.location.hostname))
        ? "remote"
        : "local";
  const line = (k: string, v: ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <span>{k}</span>
      <span className="flex items-center gap-1.5 truncate text-sidebar-foreground/80">{v}</span>
    </div>
  );
  return (
    <div className="no-drag mt-auto grid gap-1 border-t border-sidebar-border px-2 pt-3 font-mono text-2xs text-sidebar-muted-foreground">
      <Link to="/settings" className="grid gap-1 hover:text-sidebar-foreground">
        {line("next", next ?? "nothing queued")}
        {line("queued", queued?.length ?? "–")}
        {line(
          "spend",
          spend === null
            ? "–"
            : `$${spend.monthUsd.toFixed(2)} / $${spend.monthlyBudgetUsd.toFixed(0)}`,
        )}
        {line(
          "service",
          <>
            <span
              className={cn(
                "size-1.5 rounded-full",
                connection === "connected"
                  ? "bg-success"
                  : connection === "connecting"
                    ? "bg-warning"
                    : "bg-error",
              )}
            />
            {mode}
          </>,
        )}
      </Link>
    </div>
  );
}

/**
 * The one navigation for X and the tools. X's pages come first (desktop only:
 * a browser has no x.com session), then the tools, then the day's numbers.
 */
export function Sidebar({ compact = false }: { readonly compact?: boolean }) {
  const setPalette = useAtomSet(paletteOpenAtom);
  const setDragging = useAtomSet(linkDragAtom);
  // The window sees every drag, including one coming out of the x.com webview; the data is only
  // readable on drop, so until then the sidebar only knows a link is in the air.
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (carriesLink(e.dataTransfer)) setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const end = () => setDragging(false);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, [setDragging]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const queued = or(useAtomValue(queuedDraftsAtom), null);
  const inbox = or(useAtomValue(inboxItemsAtom), null);
  const pending = or(useAtomValue(pendingAtom), null);
  const openInbox = inbox?.items.filter((m) => !m.handled).length ?? null;
  const counts: Readonly<Record<string, number | null>> = {
    "/plan": queued?.length ?? null,
    "/engage": openInbox,
    "/automate": pending?.length ?? null,
  };
  const mod = window.desktopBridge?.platform === "darwin" ? "⌘" : "Ctrl";
  return (
    <aside
      aria-label="Sidebar"
      data-compact={compact}
      className="col-start-1 row-start-1 flex h-full flex-col border-r border-sidebar-border bg-sidebar pb-3 text-sidebar-foreground"
      style={{ width: compact ? 44 : 232, paddingInline: compact ? 4 : 12 }}
    >
      {compact ? (
        <div className="drag-region flex h-6 shrink-0 items-center justify-center">
          <AccountMenu compact onError={setAccountError} />
        </div>
      ) : (
        <div className="drag-region flex h-[52px] shrink-0 items-center justify-between gap-2 pr-1 pl-[calc(var(--desktop-window-controls-inset)+8px)]">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid size-[22px] place-items-center rounded-md bg-sidebar-foreground text-[13px] leading-none font-bold text-sidebar">
              x
            </span>
            {/* Beside macOS's window buttons the name would cut the account handle short. */}
            <span className="[.electron-mac_&]:hidden">Xtend</span>
          </span>
          <span className="flex items-center gap-1">
            <UpdateButton />
            <AccountMenu onError={setAccountError} />
          </span>
        </div>
      )}
      {accountError !== null ? (
        <p role="alert" className="-mt-1 mb-2 px-1 text-2xs text-error-foreground">
          {accountError}
        </p>
      ) : null}
      <button
        type="button"
        aria-label={compact ? "Search" : undefined}
        title={compact ? `Search (${mod} K)` : undefined}
        className="no-drag mb-3 flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[var(--control-radius)] bg-sidebar-control-surface pr-1.5 pl-2.5 text-[13px] text-sidebar-muted-foreground outline-hidden hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setPalette(true)}
      >
        <Search className="size-3.5" />
        {compact ? null : (
          <>
            Search
            <kbd className="ml-auto rounded-[5px] border border-white/13 px-1.5 font-mono text-2xs leading-[18px] text-sidebar-foreground/80">
              {mod} K
            </kbd>
          </>
        )}
      </button>
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isElectron ? (
          <>
            <XRows compact={compact} />
            <div className="mx-2 my-2.5 h-px shrink-0 bg-sidebar-border" />
          </>
        ) : null}
        {TOOLS.map((tool) => (
          <ToolRow
            key={tool.to}
            tool={tool}
            count={counts[tool.to]}
            hot={tool.to === "/automate"}
            compact={compact}
          />
        ))}
        <ToolRow tool={{ to: "/settings", label: "Settings" }} compact={compact} />
        {compact ? null : <Today />}
      </nav>
    </aside>
  );
}
