import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XTabs, XTitle } from "../components/xnative/XColumn";
import { at, type CommunitiesTab, engineAtom } from "../state/engine";
import { xGo, xNavigate, xPickHomeTab } from "../state/x";

const TABS = [
  { id: "home", label: "Home" },
  { id: "explore", label: "Explore" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * X's Communities, drawn by Xtend from the engine on x.com/<handle>/communities: Home, with the
 * user's Communities above posts from them, and Explore, posts from Communities to discover. X
 * labels each post with its Community.
 */
function CommunitiesScreen() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  // The signed-in account's own page, as for Lists: the handle X's page names.
  const handle = engine.viewer?.handle ?? null;
  const url = handle === null ? null : `https://x.com/${handle}/communities`;
  const open = useCallback(
    () => void (url === null ? undefined : xGo(url).then(() => xPickHomeTab(current.label))),
    [url, current.label],
  );
  // ⌘R: X's page in full, then this tab again. With no account named yet, Home names it.
  const reload = () =>
    void (url === null
      ? xNavigate("https://x.com/home")
      : xNavigate(url).then(() => xPickHomeTab(current.label)));
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  const surface: CommunitiesTab = `communities:${current.id}`;
  return (
    <Timeline
      surface={surface}
      header={
        <>
          <XTitle title="Communities" />
          <XTabs
            label="Communities"
            tabs={TABS}
            value={current.id}
            onChange={(next) => void navigate({ to: "/communities", search: { tab: next } })}
          />
        </>
      }
      top={current.id === "home" ? <MyCommunities /> : <Heading text="Discover new Communities" />}
      keepPlace
      empty={
        current.id === "home"
          ? "Loading posts from your Communities from X."
          : "Loading Communities to discover from X."
      }
      onReopen={open}
      onRefresh={reload}
    />
  );
}

const Heading = ({ text }: { readonly text: string }) => (
  <h2 className="px-4 pt-3 pb-1 text-[20px] font-extrabold">{text}</h2>
);

/** X's carousel of the user's Communities: each one's banner and name, opening it. */
function MyCommunities() {
  const engine = useAtomValue(engineAtom);
  const mine = at(engine.communityIds, "communities:mine").flatMap(
    (id) => engine.communities.get(id) ?? [],
  );
  if (mine.length === 0) return null;
  return (
    <div className="border-b border-border pb-3">
      <Heading text="My Communities" />
      <div className="flex gap-3 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
        {mine.map((c) => (
          <Link
            key={c.communityId}
            to="/communities/$id"
            params={{ id: c.communityId }}
            data-x="community-tile"
            className="flex w-[120px] shrink-0 flex-col gap-1.5 text-[13px] leading-4 font-bold"
          >
            {c.bannerUrl === null ? (
              <span className="aspect-square rounded-2xl bg-[#333639]" />
            ) : (
              <img
                src={c.bannerUrl}
                alt=""
                loading="lazy"
                className="aspect-square rounded-2xl object-cover"
              />
            )}
            <span className="line-clamp-2">{c.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/communities/")({
  validateSearch: (s: Record<string, unknown>): { tab: Tab } => ({
    tab: s.tab === "explore" ? "explore" : "home",
  }),
  component: CommunitiesScreen,
});
