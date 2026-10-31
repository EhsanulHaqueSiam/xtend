import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { Empty } from "../components/ui/layout";
import { PostRail } from "../components/xnative/PostRail";
import { ReplyComposer } from "../components/xnative/ReplyComposer";
import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XPostView } from "../components/xnative/XPostView";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

/** One post with the thread above it, joined by X's line, and the replies under it, the composer between. */
function PostScreen() {
  const { id } = Route.useParams();
  const { h } = Route.useSearch();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const openPost = useOpenPost();
  const open = useCallback(() => xNavigate(`https://x.com/${h}/status/${id}`), [h, id]);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "post")));
    open();
  }, [open, setEngine]);
  const posts = engine.lists.post.flatMap((pid) => engine.posts.get(pid) ?? []);
  const at = posts.findIndex((p) => p.postId === id);
  const focal = at === -1 ? engine.posts.get(id) : posts[at];
  const above = at === -1 ? [] : posts.slice(0, at);
  const below = at === -1 ? [] : posts.slice(at + 1);
  const quoted = (pid: string | null) => (pid === null ? undefined : engine.posts.get(pid));
  return (
    <XColumn
      header={<XTitle title="Post" onBack={() => router.history.back()} />}
      rail={<PostRail post={focal} seen={engine.posts.values()} />}
    >
      {focal === undefined ? (
        <Empty>Loading the post from X.</Empty>
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
          <XPostView post={focal} quoted={quoted(focal.quotedId)} focal onReopen={open} />
          <ReplyComposer post={focal} thread={above.map((p) => p.text)} onSent={open} />
          {below.map((p) => (
            <XPostView
              key={p.postId}
              post={p}
              quoted={quoted(p.quotedId)}
              onOpen={openPost}
              onReopen={open}
            />
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
