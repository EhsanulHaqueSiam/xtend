import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import type { EngineCommunity } from "@xtend/contracts";
import { useEffect, useState } from "react";

import {
  at,
  communitiesSearchSurface,
  communityPostsSearchSurface,
  engineAtom,
} from "../../state/engine";
import { xGo, xNavigate } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Timeline } from "./Timeline";
import { XColumn, XSearchBar, XTabs } from "./XColumn";
import { XRows } from "./XRows";

/** X's tabs on a search of Communities, each its own page: x.com/i/communities/<page>?q=. */
const SEARCH_TABS = [
  { id: "communities", label: "Communities", page: "suggested" },
  { id: "top", label: "Top", page: "top" },
  { id: "latest", label: "Latest", page: "latest" },
] as const;
export type CommunitiesSearchTab = (typeof SEARCH_TABS)[number]["id"];

/** X's own line on a search of Communities it found nothing for. */
const NO_RESULTS =
  "The term you entered did not bring up any results. Try a different search term.";

/** A Community as X's search lists it: banner, name, members and topic. Opens its own screen. */
function CommunityRow({ community }: { readonly community: EngineCommunity }) {
  const detail = [
    community.members === null ? null : `${fmt(community.members)} Members`,
    community.topic,
  ].filter((part) => part !== null);
  return (
    <Link
      to="/communities/$id"
      params={{ id: community.communityId }}
      data-x="community-row"
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-white/[0.03]"
    >
      {community.bannerUrl === null ? (
        <span className="size-12 shrink-0 rounded-xl bg-[#333639]" />
      ) : (
        <img
          src={community.bannerUrl}
          alt=""
          loading="lazy"
          className="size-12 shrink-0 rounded-xl object-cover"
        />
      )}
      <span className="min-w-0 flex-1 text-[15px] leading-5">
        <b className="block truncate font-bold">{community.name}</b>
        <span className="block truncate text-[13px] text-[#71767b]">{detail.join(" · ")}</span>
      </span>
    </Link>
  );
}

/**
 * X's search of Communities, from the hub's search icon: the engine on X's page for the open tab,
 * the Communities X finds for `q`, or posts from Communities in X's Top or Latest order. Mount it
 * keyed by the query, so the box shows a search opened afresh.
 */
export function CommunitiesSearch({
  q,
  tab,
}: {
  readonly q: string;
  readonly tab: CommunitiesSearchTab;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const [draft, setDraft] = useState(q);
  const current = SEARCH_TABS.find((t) => t.id === tab) ?? SEARCH_TABS[0];
  const url = `https://x.com/i/communities/${current.page}${q === "" ? "" : `?q=${encodeURIComponent(q)}`}`;
  // ⌘R and "Load again": X's page in full, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(() => void xGo(url), [url]);
  const surface =
    current.id === "communities"
      ? communitiesSearchSurface(q)
      : communityPostsSearchSurface(current.label, q);
  const communities = at(engine.communityIds, surface).flatMap(
    (id) => engine.communities.get(id) ?? [],
  );
  // X answered this search (the store keeps each answer's cursors) and listed nothing.
  const none =
    engine.cursors[surface] !== undefined &&
    (current.id === "communities" ? communities : at(engine.lists, surface)).length === 0;
  const header = (
    <>
      <XSearchBar
        label="Search Communities"
        placeholder="Search for Communities and Posts"
        value={draft}
        onChange={setDraft}
        onSubmit={() => void navigate({ to: "/communities", search: { q: draft.trim(), tab } })}
        onBack={() => router.history.back()}
      />
      {q === "" ? null : (
        <XTabs
          label="Results"
          tabs={SEARCH_TABS}
          value={current.id}
          onChange={(next) =>
            void navigate({ to: "/communities", search: { q, tab: next }, replace: true })
          }
        />
      )}
    </>
  );
  if (current.id !== "communities" && q !== "" && !none)
    return (
      <Timeline
        surface={surface}
        header={header}
        empty="Searching Communities on X."
        onReopen={reload}
      />
    );
  return (
    <XColumn header={header} refresh={{ surfaces: [surface], load: reload }}>
      {q === "" || none ? (
        <p className="px-4 py-6 text-center text-[15px] text-[#71767b]">
          {q === "" ? "Search results will appear here" : NO_RESULTS}
        </p>
      ) : (
        <XRows
          waitKey={surface}
          items={communities}
          rowKey={(c) => c.communityId}
          row={(c) => <CommunityRow community={c} />}
          empty="Searching Communities on X."
          onReopen={reload}
        />
      )}
    </XColumn>
  );
}
