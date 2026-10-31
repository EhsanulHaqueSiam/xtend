import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { Timeline } from "../components/xnative/Timeline";
import { XTitle } from "../components/xnative/XColumn";
import { engineAtom } from "../state/engine";
import { xGo } from "../state/x";

/** One X List's posts, drawn by Xtend from the engine on x.com/i/lists/<id>. */
function ListScreen() {
  const { id } = Route.useParams();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const list = engine.xLists.get(id);
  const open = useCallback(() => void xGo(`https://x.com/i/lists/${id}`), [id]);
  useEffect(open, [open]);
  return (
    <Timeline
      surface={`list:${id}`}
      header={
        <XTitle
          title={list?.name ?? "List"}
          detail={
            list?.owner === null || list === undefined
              ? undefined
              : `@${list.owner.handle}${list.members === null ? "" : ` · ${fmt(list.members)} members`}`
          }
          onBack={() => router.history.back()}
        />
      }
      empty="Loading the List from X."
      onReopen={open}
    />
  );
}

export const Route = createFileRoute("/lists/$id")({ component: ListScreen });
