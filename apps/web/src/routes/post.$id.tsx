import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect } from "react";

import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Empty, PageBody } from "../components/ui/layout";
import { ReplyComposer } from "../components/xnative/ReplyComposer";
import { useOpenPost } from "../components/xnative/Timeline";
import { postUrl, XPostView } from "../components/xnative/XPostView";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

/** One post with the thread above it and the replies under it, the composer between. */
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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Post"
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={() => router.history.back()}
          >
            <ArrowLeft />
          </Button>
        }
        actions={
          focal === undefined ? undefined : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.desktopBridge?.openExternal(postUrl(focal))}
            >
              Open in browser
            </Button>
          )
        }
      />
      <PageBody className="mx-auto w-full max-w-[720px] border-x border-border">
        {focal === undefined ? (
          <Empty>Loading the post from X.</Empty>
        ) : (
          <>
            {above.map((p) => (
              <XPostView key={p.postId} post={p} quoted={quoted(p.quotedId)} onOpen={openPost} />
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
      </PageBody>
    </div>
  );
}

export const Route = createFileRoute("/post/$id")({
  validateSearch: (s: Record<string, unknown>): { h: string } => ({
    h: typeof s.h === "string" ? s.h : "i",
  }),
  component: PostScreen,
});
