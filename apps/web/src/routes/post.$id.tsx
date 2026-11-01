import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PostRail } from "../components/xnative/PostRail";
import { ReplyComposer } from "../components/xnative/ReplyComposer";
import { REPLY_SORT, ReplySort } from "../components/xnative/ReplySort";
import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XPostView } from "../components/xnative/XPostView";
import { XEmpty } from "../components/xnative/XRows";
import {
  at,
  engineAtom,
  postOn,
  postSurface,
  REPLY_SORTS,
  type ReplySort as Sort,
} from "../state/engine";
import { refreshScreen, xGo, xNavigate, xSortReplies } from "../state/x";

/** One post with the thread above it, joined by X's line, and the replies under it, the composer between. */
function PostScreen() {
  const { id } = Route.useParams();
  const { h, sort = "Relevance" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  // X's page carries the reply order; each order's thread sits under its own key.
  const param = REPLY_SORT[sort].param;
  const url = `https://x.com/${h}/status/${id}${param === null ? "" : `?sort_replies=${param}`}`;
  // X's router, so a thread X still holds shows at once.
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);
  const surface = postSurface(id, sort);
  // The pick shows at once; X's page may still be drawing the post its sort sits under.
  const [picked, setPicked] = useState<Sort | null>(null);
  // X's own menu first, so the engine already shows the new order when the route asks for it.
  const sortBy = (next: Sort) => {
    setPicked(next);
    void xSortReplies(
      { postId: id, handle: h },
      REPLY_SORT[next],
      REPLY_SORTS.map((s) => REPLY_SORT[s].label),
    )
      .then((took) =>
        // Only once X took it, and while the user is still on this post: X's page may take seconds.
        took && router.state.location.pathname === `/post/${id}`
          ? navigate({
              search: { h, ...(next === "Relevance" ? {} : { sort: next }) },
              replace: true,
            })
          : undefined,
      )
      .finally(() => setPicked(null));
  };

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  // A reply through the session left the engine on X's composer, so X's router brings the thread
  // back fresh, the reply already in place. One through the API left it here: load the thread again.
  const afterReply = () => void xGo(url).then((moved) => moved || refreshScreen());
  const posts = at(engine.lists, surface).flatMap((pid) => postOn(engine, surface, pid) ?? []);
  const index = posts.findIndex((p) => p.postId === id);
  const focal = index === -1 ? engine.posts.get(id) : posts[index];
  const above = index === -1 ? [] : posts.slice(0, index);
  const below = index === -1 ? [] : posts.slice(index + 1);
  const quoted = (pid: string | null) => (pid === null ? undefined : engine.posts.get(pid));
  return (
    <XColumn
      refresh={{ surfaces: [surface], load: reload }}
      header={<XTitle title="Post" onBack={() => router.history.back()} />}
      rail={<PostRail post={focal} seen={engine.posts.values()} />}
    >
      {focal === undefined ? (
        <XEmpty key={id} empty="Loading the post from X." onReopen={reload} />
      ) : (
        <>
          {above.map((p) => (
            <XPostView
              key={p.postId}
              post={p}
              quoted={quoted(p.quotedId)}
              threaded
              onOpen={openPost}
            />
          ))}
          <XPostView
            key={focal.postId}
            post={focal}
            quoted={quoted(focal.quotedId)}
            focal
            under={
              <div className="flex items-center pt-2.5 empty:hidden">
                {/* Once X's first fetch of the thread is in: X drops a sort picked while it is out. */}
                {REPLY_SORTS.some((s) => at(engine.lists, postSurface(id, s)).length > 0) ? (
                  <ReplySort value={picked ?? sort} onChange={sortBy} />
                ) : null}
                {focal.metrics.quotes === 0 ? null : (
                  <Link
                    to="/post/$id/activity"
                    params={{ id }}
                    search={{ h, tab: "quotes" }}
                    className="ml-auto flex items-center text-[14px] text-[#71767b] hover:text-foreground"
                  >
                    View quotes
                    <ChevronRight className="size-4" />
                  </Link>
                )}
              </div>
            }
          />
          <ReplyComposer post={focal} thread={above.map((p) => p.text)} onSent={afterReply} />
          {below.map((p) => (
            <XPostView key={p.postId} post={p} quoted={quoted(p.quotedId)} onOpen={openPost} />
          ))}
        </>
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/post/$id")({
  // Relevance, X's default, stays out of the URL, so links that name only the handle keep working.
  validateSearch: (s: Record<string, unknown>): { h: string; sort?: Sort } => {
    const sort = REPLY_SORTS.find((r) => r === s.sort && r !== "Relevance");
    return { h: typeof s.h === "string" ? s.h : "i", ...(sort === undefined ? {} : { sort }) };
  },
  component: PostScreen,
});
