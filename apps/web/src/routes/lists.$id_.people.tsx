import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { XColumn, XTitle } from "../components/xnative/XColumn";
import { UserRow, XRows } from "../components/xnative/XRows";
import { at, engineAtom, listPeopleSurface } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

const KINDS = {
  members: { title: "List members", surface: "listMembers", empty: "Loading the members from X." },
  followers: {
    title: "List followers",
    surface: "listFollowers",
    empty: "Loading the followers from X.",
  },
} as const;
type Kind = keyof typeof KINDS;

/** A List's members or followers, as X's List members and List followers pages list them. */
function ListPeopleScreen() {
  const { id } = Route.useParams();
  const { of } = Route.useSearch();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const kind = KINDS[of];
  const url = `https://x.com/i/lists/${id}/${of}`;
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);
  const surface = listPeopleSurface(kind.surface, id);

  useEffect(open, [open]);
  return (
    <XColumn
      header={
        <XTitle
          title={kind.title}
          detail={engine.xLists.get(id)?.name}
          onBack={() => router.history.back()}
        />
      }
    >
      <XRows
        waitKey={surface}
        onReopen={reload}
        items={at(engine.people, surface).flatMap((uid) => engine.users.get(uid) ?? [])}
        rowKey={(u) => u.userId}
        empty={kind.empty}
        row={(u) => <UserRow user={u} />}
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/lists/$id_/people")({
  validateSearch: (s: Record<string, unknown>): { of: Kind } => ({
    of: s.of === "followers" ? "followers" : "members",
  }),
  component: ListPeopleScreen,
});
