import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { PostRail } from "../components/xnative/PostRail";
import { ReplyComposer } from "../components/xnative/ReplyComposer";
import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XPostView } from "../components/xnative/XPostView";
import { XEmpty } from "../components/xnative/XRows";
import { at, engineAtom, postOn, postSurface } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/** One post with the thread above it, joined by X's line, and the replies under it, the composer between. */
function PostScreen() {
  const { id } = Route.useParams();
  const { h } = Route.useSearch();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  // X's router, so a thread X still holds shows at once; its posts sit under the post's own key.
  const open = useCallback(() => void xGo(`https://x.com/${h}/status/${id}`), [h, id]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(`https://x.com/${h}/status/${id}`);

  useEffect(open, [open]);
  const posts = at(engine.lists, postSurface(id)).flatMap(
    (pid) => postOn(engine, postSurface(id), pid) ?? [],
  );
  const index = posts.findIndex((p) => p.postId === id);
  const focal = index === -1 ? engine.posts.get(id) : posts[index];
  const above = index === -1 ? [] : posts.slice(0, index);
  const below = index === -1 ? [] : posts.slice(index + 1);
  const quoted = (pid: string | null) => (pid === null ? undefined : engine.posts.get(pid));
  return (
    <XColumn
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
          <XPostView key={focal.postId} post={focal} quoted={quoted(focal.quotedId)} focal />
          <ReplyComposer post={focal} thread={above.map((p) => p.text)} onSent={open} />
          {below.map((p) => (
            <XPostView key={p.postId} post={p} quoted={quoted(p.quotedId)} onOpen={openPost} />
          ))}
        </>
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/post/$id")({
  validateSearch: (s: Record<string, unknown>): { h: string } => ({
    h: typeof s.h === "string" ? s.h : "i",
  }),
  component: PostScreen,
});
