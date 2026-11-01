import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EngineList } from "@xtend/contracts";
import { Lock } from "lucide-react";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XRows } from "../components/xnative/XRows";
import { Avatar } from "../components/xnative/XPostView";
import { engineAtom } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

type Row =
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "list"; readonly list: EngineList }
  | { readonly kind: "none" };

/** One List as X's Lists page shows it: banner, name, owner, members. */
function ListRow({ list }: { readonly list: EngineList }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-x="list-row"
      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={() => void navigate({ to: "/lists/$id", params: { id: list.listId } })}
    >
      {list.bannerUrl === null ? (
        <span className="size-12 shrink-0 rounded-xl bg-[#333639]" />
      ) : (
        <img
          src={list.bannerUrl}
          alt=""
          loading="lazy"
          className="size-12 shrink-0 rounded-xl object-cover"
        />
      )}
      <span className="min-w-0 flex-1 text-[15px] leading-5">
        <span className="flex items-center gap-1">
          <b className="truncate font-bold">{list.name}</b>
          {list.isPrivate ? <Lock className="size-3.5 shrink-0" /> : null}
          {list.members === null ? null : (
            <span className="shrink-0 text-[13px] text-[#71767b]">
              · {fmt(list.members)} members
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-[#71767b]">
          {list.owner === null ? null : <Avatar url={list.owner.avatarUrl} size={16} />}
          <span className="truncate">
            {list.followers === null
              ? (list.owner?.name ?? "")
              : `${fmt(list.followers)} followers${list.owner === null ? "" : ` · by ${list.owner.name}`}`}
          </span>
        </span>
      </span>
    </button>
  );
}

/** X's Lists page, drawn by Xtend from the engine on x.com/<handle>/lists: yours, then X's picks. */
function ListsScreen() {
  const engine = useAtomValue(engineAtom);
  // X's Lists page is the signed-in account's own, x.com/<handle>/lists: the handle X's page
  // names, not Settings' handle, which can name another account.
  const handle = engine.viewer?.handle ?? null;
  const open = useCallback(
    () => void (handle === null ? undefined : xGo(`https://x.com/${handle}/lists`)),
    [handle],
  );
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  // With no account named yet (X's first load failed), Home names it, and the screen then opens.
  const reload = () =>
    void xNavigate(handle === null ? "https://x.com/home" : `https://x.com/${handle}/lists`);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  const rows: Array<Row> = [];
  let group: string | null = null;
  for (const list of engine.xLists.values()) {
    if (list.group !== null && list.group !== group) rows.push({ kind: "group", name: list.group });
    group = list.group;
    rows.push({ kind: "list", list });
  }
  // X always shows the user's own Lists section, empty or not.
  if (rows.length > 0 && !rows.some((r) => r.kind === "group" && r.name === "Your Lists"))
    rows.push({ kind: "group", name: "Your Lists" }, { kind: "none" });
  return (
    <XColumn header={<XTitle title="Lists" />} refresh={{ surfaces: ["lists"], load: reload }}>
      <XRows
        waitKey="lists"
        onReopen={reload}
        items={rows}
        paged={false}
        rowKey={(r) =>
          r.kind === "group" ? `g:${r.name}` : r.kind === "list" ? r.list.listId : "none"
        }
        empty="Loading your Lists from X."
        row={(r) =>
          r.kind === "group" ? (
            <h2 className="px-4 pt-3 pb-1 text-[20px] font-extrabold">{r.name}</h2>
          ) : r.kind === "list" ? (
            <ListRow list={r.list} />
          ) : (
            <p className="px-4 py-6 text-center text-[15px] text-[#71767b]">
              You have not made or followed a List. When you do, it shows here.
            </p>
          )
        }
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/lists/")({ component: ListsScreen });
