import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import type { EngineList } from "@xtend/contracts";
import { Lock } from "lucide-react";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { Timeline } from "../components/xnative/Timeline";
import { XTitle } from "../components/xnative/XColumn";
import { Avatar } from "../components/xnative/XPostView";
import { engineAtom } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/**
 * One X List, drawn by Xtend from the engine on x.com/i/lists/<id>: X's header (banner, name,
 * owner, Members and Followers) from the List X sent, then its posts.
 */
function ListScreen() {
  const { id } = Route.useParams();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const list = engine.xLists.get(id);
  const open = useCallback(() => void xGo(`https://x.com/i/lists/${id}`), [id]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(`https://x.com/i/lists/${id}`);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  return (
    <Timeline
      surface={`list:${id}`}
      header={
        <XTitle
          title={list?.name ?? "List"}
          detail={list?.owner == null ? undefined : `@${list.owner.handle}`}
          onBack={() => router.history.back()}
        />
      }
      top={list === undefined ? undefined : <ListHeader id={id} list={list} />}
      empty="Loading the List from X."
      onReopen={reload}
    />
  );
}

function ListHeader({ id, list }: { readonly id: string; readonly list: EngineList }) {
  const count = (n: number | null, label: string, of: "members" | "followers") =>
    n === null ? null : (
      <Link to="/lists/$id/people" params={{ id }} search={{ of }} className="hover:underline">
        <b className="font-bold text-foreground">{fmt(n)}</b> {label}
      </Link>
    );
  return (
    <div data-x="list" className="border-b border-border">
      {list.bannerUrl === null ? (
        <div className="aspect-[3/1] bg-[#333639]" />
      ) : (
        <img src={list.bannerUrl} alt="" className="aspect-[3/1] w-full object-cover" />
      )}
      <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
        <p className="flex items-center gap-1 text-[20px] leading-6 font-extrabold">
          {list.name}
          {list.isPrivate ? <Lock aria-label="Private" className="size-4" /> : null}
        </p>
        {list.description === "" ? null : (
          <p className="text-[15px] leading-5 whitespace-pre-wrap">{list.description}</p>
        )}
        {list.owner === null ? null : (
          <Link
            to="/u/$handle"
            params={{ handle: list.owner.handle }}
            className="flex items-center gap-1 text-[15px] hover:underline"
          >
            <Avatar url={list.owner.avatarUrl} size={20} />
            <b className="font-bold">{list.owner.name}</b>
            <span className="text-[#71767b]">@{list.owner.handle}</span>
          </Link>
        )}
        <p className="flex gap-5 text-[15px] text-[#71767b]">
          {count(list.members, "Members", "members")}
          {count(list.followers, "Followers", "followers")}
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/lists/$id")({ component: ListScreen });
