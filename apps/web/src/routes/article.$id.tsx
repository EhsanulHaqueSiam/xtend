import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { ArticleBody } from "../components/xnative/ArticleBody";
import { PostRail } from "../components/xnative/PostRail";
import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XPostView } from "../components/xnative/XPostView";
import { XEmpty } from "../components/xnative/XRows";
import { engineAtom } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/**
 * An X Article, by the post that carries it, read from X's own reader page under the engine:
 * cover, title, the post's author row and X's buttons, then the body.
 */
function ArticleScreen() {
  const { id } = Route.useParams();
  const { h } = Route.useSearch();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  const url = `https://x.com/${h}/article/${id}`;
  // X's router, so an Article X still holds shows at once from the body kept in the store.
  const open = useCallback(() => void xGo(url), [url]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate(url);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this Article's reader page while it is open.
  useEffect(open, [open]);
  const post = engine.posts.get(id);
  const article = engine.articles.get(id);
  const card = post?.card?.kind === "article" ? post.card : null;
  return (
    <XColumn
      refresh={{ surfaces: [], load: reload }}
      header={<XTitle title="Article" onBack={() => router.history.back()} />}
      rail={<PostRail post={post} seen={engine.posts.values()} />}
    >
      {post === undefined || article === undefined ? (
        <XEmpty key={id} empty="Loading the article from X." onReopen={reload} />
      ) : (
        <>
          {card?.imageUrl == null ? null : (
            <img src={card.imageUrl} alt="" className="aspect-[5/2] w-full object-cover" />
          )}
          <h1
            data-x="article-title"
            className="px-4 pt-4 text-[31px] leading-9 font-extrabold break-words"
          >
            {card?.title}
          </h1>
          {/* X's reader draws the post's row without its text and card: the Article is both. */}
          <XPostView
            post={{ ...post, text: "", translation: null, card: null }}
            focal
            onOpen={openPost}
          />
          <ArticleBody blocks={article.blocks} />
        </>
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/article/$id")({
  validateSearch: (s: Record<string, unknown>): { h: string } => ({
    h: typeof s.h === "string" ? s.h : "i",
  }),
  component: ArticleScreen,
});
