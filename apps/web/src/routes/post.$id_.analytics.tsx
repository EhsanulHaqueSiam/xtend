import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { PostAnalytics } from "../components/xnative/PostAnalytics";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { xGo, xNavigate } from "../state/x";

/** X's Post Analytics for one of the user's own posts, read from X's own analytics page. */
function PostAnalyticsScreen() {
  const { id } = Route.useParams();
  const { h } = Route.useSearch();
  const router = useRouter();
  const url = `https://x.com/${h}/status/${id}/analytics`;
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine to X's analytics page for this post
  useEffect(open, [open]);
  return (
    <XColumn
      // The numbers stay until X's fresh ones replace them.
      refresh={{ surfaces: [], load: reload }}
      header={<XTitle title="Post Analytics" onBack={() => router.history.back()} />}
    >
      <PostAnalytics postId={id} onReopen={reload} />
    </XColumn>
  );
}

export const Route = createFileRoute("/post/$id_/analytics")({
  validateSearch: (s: Record<string, unknown>): { h: string } => ({
    h: typeof s.h === "string" ? s.h : "i",
  }),
  component: PostAnalyticsScreen,
});
