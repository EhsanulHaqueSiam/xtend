import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import type { EngineUser } from "@xtend/contracts";
import { useCallback, useEffect } from "react";

import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { UserRow, XRows } from "../components/xnative/XRows";
import { at, type ConnectTab, engineAtom } from "../state/engine";
import { xGo, xNavigate, xOverAtom, xOverEnded } from "../state/x";

const TABS = [
  {
    id: "who",
    label: "Who to follow",
    url: "https://x.com/i/connect_people",
    head: "Suggested for you",
  },
  {
    id: "creators",
    label: "Creators for you",
    url: "https://x.com/i/connect_people?is_creator_only=true",
    head: null,
  },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * X's Follow page, drawn by Xtend from the engine on x.com/i/connect_people: X's suggestions with
 * Follow, and creators with Subscribe. X sends each tab whole.
 */
function FollowScreen() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const setOver = useAtomSet(xOverAtom);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const surface: ConnectTab = `connect:${current.id}`;
  // Through X's router: a tab X still holds shows from its cache, and the store keeps its people.
  const open = useCallback(() => void xGo(current.url), [current.url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(current.url);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  // The tabs share a path, which is what ends a press elsewhere: leaving a tab by any way (its
  // tab, the sidebar, Back) ends a Subscribe begun there, and X's dialog over it.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- ends X's press and dialog when the open Follow tab changes.
  useEffect(
    () => () => {
      xOverEnded();
      setOver(false);
    },
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the open tab is the trigger: leaving it ends its press.
    [current.id, setOver],
  );

  const people = at(engine.people, surface).flatMap((id) => engine.users.get(id) ?? []);
  const rows: ReadonlyArray<EngineUser | string> =
    people.length === 0 || current.head === null ? people : [current.head, ...people];
  return (
    <XColumn
      refresh={{ surfaces: [surface], load: reload }}
      header={
        <>
          <XTitle title="Follow" onBack={() => router.history.back()} />
          <XTabs
            label="Follow"
            tabs={TABS}
            value={current.id}
            onChange={(next) => void navigate({ to: "/follow", search: { tab: next } })}
          />
        </>
      }
    >
      <XRows
        waitKey={surface}
        onReopen={reload}
        paged={false}
        items={rows}
        rowKey={(r) => (typeof r === "string" ? r : r.userId)}
        empty="Loading who to follow from X."
        row={(r) =>
          typeof r === "string" ? (
            <h2 className="px-4 pt-3 pb-1 text-[20px] font-extrabold">{r}</h2>
          ) : (
            <UserRow user={r} action={current.id === "creators" ? "subscribe" : "follow"} />
          )
        }
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/follow")({
  validateSearch: (s: Record<string, unknown>): { tab: Tab } => ({
    tab: s.tab === "creators" ? "creators" : "who",
  }),
  component: FollowScreen,
});
