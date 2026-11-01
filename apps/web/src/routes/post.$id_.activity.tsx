import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { UserRow, XRows } from "../components/xnative/XRows";
import { at, engineAtom, postPeopleSurface, quotesQuery, searchSurface } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/** X's Post activity tabs; Likes only on the user's own posts. */
const TABS = [
  { id: "quotes", label: "Quotes" },
  { id: "reposts", label: "Reposts" },
  { id: "likes", label: "Likes" },
] as const;
type Tab = (typeof TABS)[number]["id"];
/** The x.com page X shows each tab on, under the post's own. */
const PAGE: Readonly<Record<Tab, string>> = {
  quotes: "quotes",
  reposts: "retweets",
  likes: "likes",
};

/** Who quoted, reposted and (on your own post) liked a post, as X's Post activity lists them. */
function PostActivityScreen() {
  const { id } = Route.useParams();
  const { h, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const own = engine.viewer !== null && engine.viewer.handle.toLowerCase() === h.toLowerCase();
  const tabs = TABS.filter((t) => own || t.id !== "likes");
  const url = `https://x.com/${h}/status/${id}/${PAGE[tab]}`;
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine to X's page for the open tab
  useEffect(open, [open]);
  const header = (
    <>
      <XTitle title="Post activity" onBack={() => router.history.back()} />
      <XTabs
        label="Post activity"
        tabs={tabs}
        value={tab}
        onChange={(next) => void navigate({ search: { h, tab: next }, replace: true })}
      />
    </>
  );
  if (tab === "quotes")
    return (
      <Timeline
        surface={searchSurface("Top", quotesQuery(id))}
        header={header}
        empty="Loading the quotes from X."
        onReopen={reload}
      />
    );
  const surface = postPeopleSurface(tab === "reposts" ? "reposters" : "likers", id);
  return (
    <XColumn header={header}>
      <XRows
        waitKey={surface}
        onReopen={reload}
        items={at(engine.people, surface).flatMap((uid) => engine.users.get(uid) ?? [])}
        rowKey={(u) => u.userId}
        empty={tab === "reposts" ? "Loading who reposted from X." : "Loading who liked from X."}
        row={(u) => <UserRow user={u} />}
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/post/$id_/activity")({
  validateSearch: (s: Record<string, unknown>): { h: string; tab: Tab } => ({
    h: typeof s.h === "string" ? s.h : "i",
    tab: TABS.find((t) => t.id === s.tab)?.id ?? "quotes",
  }),
  component: PostActivityScreen,
});
