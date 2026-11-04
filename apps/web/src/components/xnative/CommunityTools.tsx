import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  Flag,
  Inbox,
  List,
  ListPlus,
  LogOut,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { engineAtom, moderates, roleIn, waitingIn } from "../../state/engine";
import {
  xCommunityChecklist,
  xGo,
  xNavigate,
  xOverAtom,
  xOverPage,
  xPressToPage,
  xSentHome,
} from "../../state/x";
import { ICON_BUTTON } from "./CommunityHeader";
import { xtendRoute } from "./RichText";
import { useXPress } from "./useXPress";

/** Whether Xtend draws the x.com page at `href`: where X's own page over the main area hands back. */
const drawn = (href: string) => xtendRoute(href) !== null;

/**
 * Runs X's own page or control for the user's click (`open` resolves where X settled, see
 * `xOverPage`), then shows Xtend's screen for that page: this one again runs `again`, as X's
 * answer there may have changed (a setting saved).
 */
export function useOnX() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const setOver = useAtomSet(xOverAtom);
  const { blocked, setToast } = useXPress();
  return async (
    name: string,
    open: (over: (shown: boolean) => void) => Promise<string | false | null>,
    again?: () => void,
  ) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    // X's page leaves the main area only once Xtend shows where X settled, so the screen under it
    // never acts on X's answers from the moment between (a role X just took away).
    let done = false;
    const settled = await open((shown) => (shown ? setOver(true) : (done = true)));
    const route = typeof settled === "string" ? xtendRoute(settled) : null;
    if (route !== null && route.split("?")[0] !== pathname) await navigate({ href: route });
    else if (route !== null) again?.();
    if (done) setOver(false);
    if (settled === false)
      setToast({ text: `X is not showing ${name} now. Try again in a moment.` });
  };
}

/**
 * Moves the engine to X's page `path` (a Community's Admin tools) while the screen is open, and
 * follows X Home when X's role rules send the user there instead. The reload ⌘R runs.
 */
export function useAdminPage(path: string) {
  const navigate = useNavigate();
  const url = `https://x.com${path}`;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page, and follows X's Redirect Home.
  useEffect(() => {
    const live = new AbortController();
    void xGo(url)
      .then(() => xSentHome(path, live.signal))
      .then((home) => (home ? navigate({ to: "/home", search: { feed: "following" } }) : null));
    return () => live.abort();
  }, [path, url, navigate]);
  return () => void xNavigate(url);
}

/** X's own page `path` over the main area for the user's click (see `useOnX`). */
export const onXPage = (path: string) => (over: (shown: boolean) => void) =>
  xOverPage(path, drawn, over);

/** X's own control `label` on X's page `page` for the user's click (see `useOnX`). */
export const onXControl =
  (page: string, label: string, checked?: boolean, done = drawn) =>
  (over: (shown: boolean) => void) =>
    xPressToPage(page, label, done, over, checked);

/**
 * Where X is done creating a Community: a page Xtend draws, but not the new Community under X's
 * summary (`?show_creation_summary`), which X's Got it replaces. Compact X draws that summary as
 * its page, not a dialog.
 */
const created = (href: string) =>
  drawn(href) && !new URL(href).searchParams.has("show_creation_summary");

/** X's count badge on a row or the gear: what waits on the Community's moderators. */
function Count({ n }: { readonly n: number | undefined | null }) {
  if (n === undefined || n === null || n <= 0) return null;
  return (
    <span className="min-w-5 rounded-full bg-[#1d9bf0] px-1.5 text-center text-[12px] leading-5 font-bold text-white tabular-nums">
      {n > 99 ? "99+" : n}
    </span>
  );
}

type Tool =
  | { readonly group: string }
  | {
      readonly label: string;
      readonly description?: string;
      readonly icon: LucideIcon;
      readonly count?: number | null | undefined;
      readonly run: () => void;
      readonly current?: boolean;
    };

/**
 * X's Admin tools for a Community, in X's order and by X's role rules, with Xtend's Review all on
 * top: Review needed, Community management (some rows only for its admins), and for a moderator
 * X's Leave moderation team. The queues and General settings are Xtend's screens; every other tool
 * opens X's own page over the main area. `rail` draws it beside an open tool, without descriptions.
 */
export function CommunityToolList({
  communityId,
  current,
  rail = false,
}: {
  readonly communityId: string;
  readonly current?: "settings" | "member_requests" | "reported_tweets" | "review";
  readonly rail?: boolean;
}) {
  const engine = useAtomValue(engineAtom);
  const navigate = useNavigate();
  const onX = useOnX();
  const role = roleIn(engine, communityId);
  const admin = engine.communityAdmin.get(communityId);
  // X's counts, less the rows X decided for the user's presses since.
  const waiting = waitingIn(engine, communityId);
  const members = engine.communities.get(communityId)?.members ?? null;
  const base = `/i/communities/${communityId}`;
  const isAdmin = role === "Admin";
  const page = (label: string, path: string) => () => void onX(label, onXPage(path));
  const queue = (to: "member_requests" | "reported_tweets" | "review") => () =>
    void navigate({
      to: "/communities/$id/moderation/$queue",
      params: { id: communityId, queue: to },
    });
  const tools: ReadonlyArray<Tool | false> = [
    { group: "Review needed" },
    // Xtend's own: X's two queues in one list.
    {
      label: "Review all",
      icon: Inbox,
      count: waiting.reported + (waiting.requests ?? 0),
      current: current === "review",
      run: queue("review"),
    },
    {
      label: "Reported posts",
      icon: Flag,
      count: waiting.reported,
      current: current === "reported_tweets",
      run: queue("reported_tweets"),
    },
    // X lists requests only for a Community that takes them.
    typeof admin?.requests === "number" && {
      label: "Member requests",
      icon: UserPlus,
      count: waiting.requests,
      current: current === "member_requests",
      run: queue("member_requests"),
    },
    {
      label: "Moderation log",
      icon: ScrollText,
      run: page("Moderation log", `${base}/moderation/moderation_log`),
    },
    { group: "Community management" },
    isAdmin && {
      label: "General settings",
      description: "Edit Community name, purpose, and more",
      icon: Settings,
      current: current === "settings",
      run: () =>
        void navigate({ to: "/communities/$id/tools/settings", params: { id: communityId } }),
    },
    isAdmin && {
      label: "Spam settings",
      description: "Adjust spam filter and report tools",
      icon: Shield,
      run: page("Spam settings", `${base}/tools/spam_settings`),
    },
    {
      label: "Members",
      ...(members === null
        ? {}
        : { description: `${members.toLocaleString("en-US")} member${members === 1 ? "" : "s"}` }),
      icon: Users,
      run: page("Members", `${base}/tools/members`),
    },
    {
      label: "Rules",
      description: isAdmin ? "Add, delete, or edit rules" : "View rules",
      icon: List,
      run: page("Rules", `${base}/tools/rules`),
    },
    {
      label: "Analytics",
      description: "Look at community metrics",
      icon: BarChart3,
      run: page("Analytics", `${base}/tools/analytics`),
    },
    isAdmin && {
      label: "Community list",
      description: "Add or remove a Community list",
      icon: ListPlus,
      run: page("Community list", `${base}/tools/lists`),
    },
    // X's row goes to its Profile Spotlight, or first to its switch to a professional profile.
    typeof admin?.spotlight === "string" && {
      label: "Spotlight your Community",
      description: "Show this Community on your profile",
      icon: Sparkles,
      run: page("Spotlight your Community", admin.spotlight),
    },
    {
      label: "Support and resources",
      description: "Useful guide for Community moderation",
      icon: ExternalLink,
      run: () => openExternal("https://help.x.com/using-twitter/communities"),
    },
    role === "Moderator" && {
      label: "Leave moderation team",
      icon: LogOut,
      run: () =>
        void onX("Leave moderation team", onXControl(`${base}/tools`, "Leave moderation team")),
    },
  ];
  const rows = tools.map((tool, i) =>
    tool === false ? null : "group" in tool ? (
      <h2
        key={tool.group}
        className={cn(
          "px-4 pb-1 font-bold text-[#71767b]",
          rail ? "pt-2 text-[13px]" : "pt-4 text-[15px]",
          i === 0 && "pt-1",
        )}
      >
        {tool.group}
      </h2>
    ) : (
      <button
        key={tool.label}
        type="button"
        aria-current={tool.current ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 px-4 text-left transition-colors duration-150 hover:bg-white/[0.03]",
          rail ? "py-2 text-[15px]" : "py-3",
          tool.current && "bg-white/[0.06] font-bold",
          tool.label === "Leave moderation team" && "text-[#f4212e]",
        )}
        onClick={tool.run}
      >
        <tool.icon className="size-5 shrink-0 text-[#71767b]" />
        <span className="min-w-0 flex-1 leading-5">
          <span className="block truncate">{tool.label}</span>
          {rail || tool.description === undefined ? null : (
            <span className="block truncate text-[13px] text-[#71767b]">{tool.description}</span>
          )}
        </span>
        <Count n={tool.count} />
        {rail ? null : <ChevronRight className="size-4 shrink-0 text-[#71767b]" />}
      </button>
    ),
  );
  if (!rail) return <div data-x="community-tools">{rows}</div>;
  return (
    <section data-x="community-tools" className="rounded-2xl border border-white/[0.12] py-2">
      <h2 className="px-4 pb-1 text-[17px] leading-6 font-extrabold">
        {isAdmin ? "Admin tools" : "Moderator tools"}
      </h2>
      {rows}
    </section>
  );
}

/** Opens a page off x.com: the default browser on the desktop, a new tab in a browser. */
const openExternal = (url: string) =>
  window.desktopBridge === undefined
    ? void window.open(url, "_blank", "noreferrer")
    : window.desktopBridge.openExternal(url);

/**
 * X's gear in a Community's top bar for its admins and moderators ("Admin tools", "Moderator
 * tools"), with X's count of what waits on them: requests and reported posts.
 */
export function AdminToolsButton({ communityId }: { readonly communityId: string }) {
  const engine = useAtomValue(engineAtom);
  const role = roleIn(engine, communityId);
  if (!moderates(role)) return null;
  const { reported, requests } = waitingIn(engine, communityId);
  const waiting = (requests ?? 0) + reported;
  return (
    <Link
      to="/communities/$id/tools"
      params={{ id: communityId }}
      aria-label={role === "Admin" ? "Admin tools" : "Moderator tools"}
      className={cn(ICON_BUTTON, "relative")}
    >
      <Settings className="size-5" />
      {waiting > 0 ? (
        <span className="absolute -top-0.5 -right-0.5">
          <Count n={waiting} />
        </span>
      ) : null}
    </Link>
  );
}

/**
 * X's Create a new Community on the user's Communities page, as X offers it: its form, or for an
 * unverified account X's Premium upsell, each X's own page over the main area. Xtend shows the new
 * Community once X does, after X's "About your new Community". None when X offers none.
 */
export function CreateCommunityButton({ handle }: { readonly handle: string | null }) {
  const offer = useAtomValue(engineAtom).communityCreate;
  const onX = useOnX();
  if (handle === null || (offer !== "create" && offer !== "verify")) return null;
  return (
    <button
      type="button"
      aria-label="Create a new Community"
      className={ICON_BUTTON}
      onClick={() =>
        void onX(
          "Create a new Community",
          onXControl(`/${handle}/communities`, "Create a new Community", undefined, created),
        )
      }
    >
      <Plus className="size-5" />
    </button>
  );
}

/**
 * X's checklist for a new Community, drawn atop its posts while X draws it on the Community's page
 * (X keeps it in its own page, read there). Each row presses X's own, which marks it done and
 * opens that step; its ✕ is X's Dismiss Checklist.
 */
export function CommunityChecklist({ communityId }: { readonly communityId: string }) {
  const engine = useAtomValue(engineAtom);
  const onX = useOnX();
  // X's card as last read, for the Community it was read on.
  const [card, setCard] = useState<{
    readonly id: string;
    readonly rows: Awaited<ReturnType<typeof xCommunityChecklist>>;
  } | null>(null);
  const admin = roleIn(engine, communityId) === "Admin";
  const read = () =>
    void xCommunityChecklist(communityId).then((rows) => setCard({ id: communityId, rows }));
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's checklist card off X's page for this Community, which only X's page holds.
  useEffect(() => {
    if (admin)
      void xCommunityChecklist(communityId).then((rows) => setCard({ id: communityId, rows }));
  }, [admin, communityId]);
  const rows = admin && card?.id === communityId ? card.rows : null;
  if (rows === null) return null;
  const page = `/i/communities/${communityId}`;
  return (
    <section data-x="community-checklist" className="border-b border-border px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[20px] leading-6 font-extrabold">Community checklist</h2>
        <button
          type="button"
          aria-label="Dismiss Checklist"
          className={cn(ICON_BUTTON, "-mt-1 -mr-2")}
          onClick={() => void onX("Dismiss Checklist", onXControl(page, "Dismiss Checklist"), read)}
        >
          <X className="size-5" />
        </button>
      </div>
      <p className="mt-1 text-[15px] text-[#71767b]">
        Just a few things to get your Community in good shape for its debut ...
      </p>
      <ul className="mt-3 flex flex-col">
        {rows.map((row) => (
          <li key={row.title}>
            <button
              type="button"
              disabled={row.done}
              className="flex w-full cursor-pointer items-center justify-between py-2 text-left text-[15px] font-bold disabled:cursor-default"
              onClick={() => void onX(row.title, onXControl(page, row.title), read)}
            >
              {row.title}
              {row.done ? (
                <Check aria-label="Completed" className="size-5 text-[#00ba7c]" />
              ) : (
                <Circle aria-label="Uncompleted" className="size-5 text-[#536471]" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
