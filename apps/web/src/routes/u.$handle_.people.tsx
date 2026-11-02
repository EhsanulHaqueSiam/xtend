import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Empty } from "../components/ui/layout";
import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { UserRow, XRows } from "../components/xnative/XRows";
import { at, engineAtom, type FollowersTab, followersSurface, userByHandle } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/** X's tabs over a profile's people, in X's order, each by the x.com path it shows on. */
const TABS = [
  { id: "verified_followers", label: "Verified Followers", none: "No verified followers." },
  {
    id: "followers_you_follow",
    label: "Followers you know",
    none: "No one you follow follows them.",
  },
  { id: "followers", label: "Followers", none: "No followers." },
  { id: "following", label: "Following", none: "Not following anyone." },
] as const satisfies ReadonlyArray<{ id: FollowersTab; label: string; none: string }>;

/**
 * A profile's people as X's pages under x.com/<handle> list them, each with X's Follow. The
 * profile's Following and Followers counts open it.
 */
function PeopleScreen() {
  const { handle } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const current = TABS.find((t) => t.id === tab)!;
  const user = userByHandle(engine, handle);
  // X shows Followers you know only once it counted at least one, never on the user's own profile.
  const own = engine.viewer?.handle.toLowerCase() === handle.toLowerCase();
  const known = !own && (engine.knownFollowers.get(user?.userId ?? "") ?? 0) > 0;
  const tabs = known ? TABS : TABS.filter((t) => t.id !== "followers_you_follow");
  const url = `https://x.com/${handle}/${tab}`;
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine to X's page for the open tab
  useEffect(open, [open]);
  // Until X names the person the list stays empty (keyed by the handle, which nothing fills).
  const surface = followersSurface(tab, user?.userId ?? `@${handle.toLowerCase()}`);
  const people = at(engine.people, surface).flatMap((id) => engine.users.get(id) ?? []);
  return (
    <XColumn
      header={
        <>
          <XTitle
            title={user?.name ?? handle}
            detail={`@${user?.handle ?? handle}`}
            onBack={() => router.history.back()}
          />
          <XTabs
            label="People"
            tabs={tabs}
            value={tab}
            onChange={(next) =>
              void navigate({
                to: "/u/$handle/people",
                params: { handle },
                search: { tab: next },
                replace: true,
              })
            }
          />
        </>
      }
    >
      {/* X answered with nobody: its cursors are in, its people are not. */}
      {people.length === 0 && engine.cursors[surface] !== undefined ? (
        <Empty>{current.none}</Empty>
      ) : (
        <XRows
          waitKey={surface}
          onReopen={reload}
          items={people}
          rowKey={(u) => u.userId}
          empty={`Loading ${current.label} from X.`}
          row={(u) => <UserRow user={u} />}
        />
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/u/$handle_/people")({
  validateSearch: (s: Record<string, unknown>): { tab: FollowersTab } => ({
    tab: TABS.find((t) => t.id === s.tab)?.id ?? "followers",
  }),
  component: PeopleScreen,
});
