import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import type { EngineCommunity, EnginePeopleSection } from "@xtend/contracts";
import { useCallback, useEffect, useState } from "react";

import { fmt } from "../components/analyze/ui";
import { Timeline } from "../components/xnative/Timeline";
import { useXPress } from "../components/xnative/useXPress";
import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { xtendRoute } from "../components/xnative/RichText";
import { UserRow, XEmpty } from "../components/xnative/XRows";
import {
  askMembership,
  at,
  type CommunityRole,
  communityRole,
  type CommunityTab,
  communitySurface,
  engineAtom,
  updateEngine,
} from "../state/engine";
import {
  type MembershipAction,
  xCommunityJoin,
  xGo,
  xNavigate,
  xOverAtom,
  xOverEnded,
} from "../state/x";

// Each tab is its own page on X, as x.com/i/communities/<id>/latest.
const TABS = [
  { id: "top", label: "Top", path: "" },
  { id: "latest", label: "Latest", path: "/latest" },
  { id: "media", label: "Media", path: "/media" },
  { id: "about", label: "About", path: "/about" },
] as const satisfies ReadonlyArray<{ id: string; label: CommunityTab; path: string }>;
type Tab = (typeof TABS)[number]["id"];
const TAB_IDS: ReadonlySet<string> = new Set(TABS.map((t) => t.id));

/**
 * One Community, drawn by Xtend from the engine on x.com/i/communities/<id>: X's header (banner,
 * name, members, X's Join) from the Community X sent, then the open tab: its posts, its media, or
 * About with its rules, moderators and members.
 */
function CommunityScreen() {
  const { id } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const setOver = useAtomSet(xOverAtom);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const community = engine.communities.get(id);
  const url = `https://x.com/i/communities/${id}${current.path}`;
  const open = useCallback(() => void xGo(url), [url]);
  // ⌘R and "Load again": X's page in full, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  // The tabs share a path, which is what ends a press elsewhere: leaving a tab ends X's dialog.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- ends X's press and dialog when the open Community tab changes.
  useEffect(
    () => () => {
      xOverEnded();
      setOver(false);
    },
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the open tab is the trigger: leaving it ends its press.
    [current.id, setOver],
  );

  const surface = communitySurface(id, current.label);
  const header = (
    <XTitle
      title={community?.name ?? "Community"}
      detail={community?.members == null ? undefined : `${fmt(community.members)} Members`}
      onBack={() => router.history.back()}
    />
  );
  const top = (
    <div data-x="community">
      {community === undefined ? null : <CommunityHeader community={community} />}
      <div className="border-b border-border">
        <XTabs
          label="Community"
          tabs={TABS}
          value={current.id}
          onChange={(next) =>
            void navigate({ to: "/communities/$id", params: { id }, search: { tab: next } })
          }
        />
      </div>
    </div>
  );
  if (current.label === "About")
    return (
      <XColumn header={header} refresh={{ surfaces: [surface], load: reload }}>
        {top}
        <About community={community} sections={at(engine.sections, surface)} onReopen={reload} />
      </XColumn>
    );
  return (
    <Timeline
      surface={surface}
      header={header}
      top={top}
      empty={
        current.label === "Media"
          ? "Loading the Community's media from X."
          : "Loading the Community from X."
      }
      onReopen={reload}
    />
  );
}

function CommunityHeader({ community }: { readonly community: EngineCommunity }) {
  return (
    <>
      {community.bannerUrl === null ? (
        <div className="aspect-[3/1] bg-[#333639]" />
      ) : (
        <img src={community.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
      )}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[24px] leading-7 font-extrabold">{community.name}</p>
          {community.topic === null ? null : (
            <p className="text-[15px] text-[#71767b]">{community.topic}</p>
          )}
          {community.members === null ? null : (
            <p className="mt-2 text-[15px] text-[#71767b]">
              <b className="font-bold text-foreground">{fmt(community.members)}</b> Members
            </p>
          )}
        </div>
        <JoinButton community={community} />
      </div>
    </>
  );
}

/** The role X's words on its membership button say the viewer has. */
const roleOf = (label: string): CommunityRole =>
  label === "Joined"
    ? "Member"
    : label === "Requested" || label === "Pending"
      ? "Requested"
      : "NonMember";

/** X's membership button for a role and policy: its words, and what pressing it does. */
const membershipButton = (
  role: string | null,
  joinPolicy: string | null,
): { readonly label: string; readonly action: MembershipAction | null } | null =>
  role === null
    ? null
    : role === "Requested"
      ? { label: "Requested", action: null }
      : role !== "NonMember"
        ? { label: "Joined", action: "leave" }
        : joinPolicy === "Open"
          ? { label: "Join", action: "join" }
          : { label: "Ask to join", action: "ask" };

/**
 * X's Join, Ask to join or Joined for the user's click, pressed on X's own button. Asking first
 * shows X's rules dialog over the main area, and leaving X's confirm. What X took stays in the
 * store until X's capture agrees, since X's own page shows it from its cache; a button X has
 * turned since is not pressed, and Xtend's takes X's words.
 */
function JoinButton({ community }: { readonly community: EngineCommunity }) {
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const [busy, setBusy] = useState(false);
  const button = membershipButton(communityRole(engine, community), community.joinPolicy);
  if (button === null) return null;
  const { label, action } = button;
  const press = async () => {
    if (action === null) return;
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    setBusy(true);
    const after = await xCommunityJoin(community.communityId, action, setOver);
    setBusy(false);
    if (after === null) return setToast({ text: "X did not take that. Try again in a moment." });
    setEngine(updateEngine((s) => askMembership(s, community.communityId, roleOf(after.label))));
    if (after.refused)
      setToast({ text: `X shows ${after.label} for this Community now, so nothing was pressed.` });
  };
  return (
    <button
      type="button"
      disabled={busy || action === null}
      aria-label={`${label} ${community.name}`}
      className={
        action === "join" || action === "ask"
          ? "h-9 shrink-0 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          : "h-9 shrink-0 cursor-pointer rounded-full border border-white/[0.35] px-4 text-[15px] font-bold transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-60"
      }
      onClick={() => void press()}
    >
      {label}
    </button>
  );
}

/**
 * X's About: what the Community is for, its numbered rules, then X's own boxes of people
 * (Moderators, Members), each with X's "Show more", which opens X's full list on x.com.
 */
function About({
  community,
  sections,
  onReopen,
}: {
  readonly community: EngineCommunity | undefined;
  readonly sections: ReadonlyArray<EnginePeopleSection>;
  readonly onReopen: () => void;
}) {
  const engine = useAtomValue(engineAtom);
  const navigate = useNavigate();
  const showMore = (link: string) => {
    const inside = xtendRoute(link);
    if (inside !== null) return void navigate({ href: inside });
    void xNavigate(link);
    void navigate({ to: "/x" });
  };
  return (
    <>
      {community === undefined ? null : (
        <section data-x="community-about" className="border-b border-border px-4 py-3">
          <h2 className="text-[20px] font-extrabold">Community Info</h2>
          {community.description === null ? null : (
            <p className="mt-2 text-[15px] leading-5 whitespace-pre-wrap">
              {community.description}
            </p>
          )}
          {community.rules === null || community.rules.length === 0 ? null : (
            <>
              <h3 className="mt-4 text-[17px] font-bold">Rules</h3>
              <ol className="mt-1 flex flex-col">
                {community.rules.map((r, i) => (
                  <li key={r.name} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2 py-2">
                    <span className="text-[15px] text-[#71767b]">{i + 1}</span>
                    <span className="text-[15px] leading-5">
                      <b className="font-bold">{r.name}</b>
                      {r.description === "" ? null : (
                        <span className="block text-[#71767b]">{r.description}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
      {sections.length === 0 ? (
        <XEmpty
          key={community?.communityId ?? ""}
          empty="Loading the Community's moderators and members from X."
          onReopen={onReopen}
        />
      ) : (
        // A few people each: X sends the rest behind "Show more".
        sections.map(({ title, userIds, link }) => (
          <section key={title} data-x="people-section" className="border-b border-border">
            <h2 className="px-4 pt-3 pb-1 text-[20px] font-extrabold">{title}</h2>
            {userIds.flatMap((userId) => {
              const user = engine.users.get(userId);
              return user === undefined ? [] : [<UserRow key={userId} user={user} />];
            })}
            {link === null ? null : (
              <button
                type="button"
                className="w-full cursor-pointer px-4 py-3 text-left text-[15px] text-[#1d9bf0] transition-colors duration-150 hover:bg-white/[0.03]"
                onClick={() => showMore(link)}
              >
                Show more
              </button>
            )}
          </section>
        ))
      )}
    </>
  );
}

export const Route = createFileRoute("/communities/$id")({
  // Optional, so a link to a Community needs no tab: Top is the default.
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    typeof s.tab === "string" && s.tab !== "top" && TAB_IDS.has(s.tab) ? { tab: s.tab as Tab } : {},
  component: CommunityScreen,
});
