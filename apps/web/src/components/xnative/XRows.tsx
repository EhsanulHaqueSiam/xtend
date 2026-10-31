import { useNavigate } from "@tanstack/react-router";
import type { EngineUser } from "@xtend/contracts";
import { useRef, type ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";

import { xScrollMore } from "../../state/x";
import { Empty } from "../ui/layout";
import { useXScrollParent } from "./XColumn";
import { Avatar, Verified } from "./XPostView";

/** How often a list may ask X for its next page; X's own scrolling pace, not faster. */
const MORE_EVERY_MS = 1500;

/**
 * Any X list that is not posts (notifications, people, trends, Lists), virtualized against the
 * column's scroll. Reaching the end scrolls X's own page so X fetches the next one.
 */
export function XRows<A>({
  items,
  rowKey,
  row,
  empty,
  paged = true,
}: {
  readonly items: ReadonlyArray<A>;
  readonly rowKey: (item: A) => string;
  readonly row: (item: A, index: number) => ReactNode;
  readonly empty: ReactNode;
  /** X pages this list on scroll; false for lists X sends whole. */
  readonly paged?: boolean;
}) {
  const scroller = useXScrollParent();
  const lastMore = useRef(0);
  if (items.length === 0) return <Empty>{empty}</Empty>;
  if (scroller === null) return null;
  return (
    <Virtuoso
      customScrollParent={scroller}
      data={items}
      computeItemKey={(_, item) => rowKey(item)}
      increaseViewportBy={800}
      endReached={() => {
        if (!paged || Date.now() - lastMore.current < MORE_EVERY_MS) return;
        lastMore.current = Date.now();
        void xScrollMore();
      }}
      itemContent={(index, item) => row(item, index)}
    />
  );
}

/** A person as X lists them: face, name, handle, "Follows you", bio; a click opens the profile. */
export function UserRow({ user }: { readonly user: EngineUser }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-x="user"
      className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)] gap-x-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={() => void navigate({ to: "/u/$handle", params: { handle: user.handle } })}
    >
      <Avatar url={user.avatarUrl} size={40} />
      <span className="min-w-0 text-[15px] leading-5">
        <span className="flex items-center gap-1">
          <b className="truncate font-bold">{user.name}</b>
          {user.verified ? <Verified /> : null}
        </span>
        <span className="flex items-center gap-1.5 text-[#71767b]">
          <span className="truncate">@{user.handle}</span>
          {user.followsYou ? (
            <span className="shrink-0 rounded bg-white/[0.08] px-1 text-[12px]">Follows you</span>
          ) : null}
        </span>
        {user.bio === "" ? null : <span className="mt-1 line-clamp-2 block">{user.bio}</span>}
      </span>
    </button>
  );
}
