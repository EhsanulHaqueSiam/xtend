import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  articleWords,
  copyLeavesOut,
  type Draft,
  type EngineArticleBlock,
  type EngineXArticle,
  fromReaderBlocks,
  parseArticle,
  readInline,
} from "@xtend/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { PenLine } from "lucide-react";
import { useEffect, useState } from "react";

import { ArticleEditor, UPGRADE_URL } from "../components/articles/ArticleEditor";
import { failText } from "../components/compose/AssistPanel";
import { type SectionId, useSection } from "../components/shell/sections";
import { XLink } from "../components/ui/x-link";
import { ArticleBody } from "../components/xnative/ArticleBody";
import { XColumn, XTitle } from "../components/xnative/XColumn";
import { XEmpty } from "../components/xnative/XRows";
import { isElectron } from "../env";
import { fmtWhen } from "../lib/time";
import { cn } from "../lib/utils";
import { articlesAccessAtom, createDraftAtom, draftsAtom } from "../state/compose";
import { engineAtom } from "../state/engine";
import { ARTICLES_URL, xArticlesAccess, xGo, xPickHomeTab } from "../state/x";

type Tab = SectionId<"/articles">;

/** X's empty states for its two lists (bundle.TwitterArticles), and Xtend's for its queue. */
const EMPTY: Readonly<Record<Tab, string>> = {
  drafts: "Your drafts live here",
  queued: "Articles you queue or schedule wait here",
  published: "Your published Articles live here",
};

const badge = (label: string, tone: "draft" | "queued" | "published" | "x") => (
  <span
    className={cn(
      "rounded-md px-1.5 text-[13px] font-semibold",
      tone === "published" && "bg-[#00ba7c]/20 text-[#00ba7c]",
      tone === "queued" && "bg-[#1d9bf0]/20 text-[#1d9bf0]",
      tone === "draft" && "bg-[#7856ff]/25 text-[#c5b8ff]",
      tone === "x" && "bg-white/10 text-foreground",
    )}
  >
    {label}
  </span>
);

/** The first words of a draft's body, as X's list shows an Article's preview text. */
const previewOf = (body: string) =>
  parseArticle(body)
    .flatMap((b) =>
      "text" in b && b.kind !== "code" && b.kind !== "latex" ? [readInline(b.text).text] : [],
    )
    .join(" ")
    .slice(0, 160);

function Row({
  tag,
  when,
  title,
  preview,
  onOpen,
}: {
  readonly tag: React.ReactNode;
  readonly when: string;
  readonly title: string;
  readonly preview: string;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer flex-col gap-1.5 border-b border-white/[0.12] px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={onOpen}
    >
      <span className="flex items-center gap-2 text-[15px] text-[#71767b]">
        {tag}
        {when}
      </span>
      <span className={cn("text-[17px] leading-6 font-bold", title === "" && "text-[#71767b]")}>
        {title === "" ? "(Needs title)" : title}
      </span>
      {preview === "" ? null : (
        <span className="line-clamp-2 text-[15px] text-[#71767b]">{preview}</span>
      )}
    </button>
  );
}

/**
 * X's Articles page drawn by Xtend: Drafts, Queued and Published (the sidebar's sections). Xtend's
 * own article drafts, and beside them the user's Articles on x.com as the engine reads them off
 * X's Articles page, which open read-only. For an account X gives no Articles, X's upsell.
 */
function ArticlesHome({ tab }: { readonly tab: Tab }) {
  const navigate = useNavigate();
  const drafts = AsyncResult.getOrElse(useAtomValue(draftsAtom), (): ReadonlyArray<Draft> => []);
  const engine = useAtomValue(engineAtom);
  const access = useAtomValue(articlesAccessAtom);
  const setAccess = useAtomSet(articlesAccessAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine to X's Articles page, and its list to the open section, while it shows.
  useEffect(() => {
    if (!isElectron) return;
    let live = true;
    const loaded = xGo(ARTICLES_URL);
    void xArticlesAccess(loaded).then((seen) => {
      if (!live || seen === null) return;
      setAccess(seen);
      // X's list switches in place: its Published tab, or back to Drafts.
      if (seen && tab !== "queued") void xPickHomeTab(tab === "published" ? "Published" : "Drafts");
    });
    return () => {
      live = false;
    };
  }, [tab, setAccess]);

  const mine = drafts
    .filter((d) => d.kind === "article")
    .filter((d) =>
      tab === "drafts"
        ? d.status === "draft" || d.status === "failed"
        : tab === "queued"
          ? d.status === "queued" || d.status === "posting"
          : d.status === "posted",
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const posted = new Set(mine.flatMap((d) => d.postIds));
  const list =
    tab === "drafts"
      ? engine.xArticles.Draft
      : tab === "published"
        ? engine.xArticles.Published
        : [];
  const onX = (list ?? [])
    .flatMap((id) => engine.xArticles.byId.get(id) ?? [])
    .filter((a) => a.postId === null || !posted.has(a.postId));
  const open = (draft: string) => void navigate({ to: "/articles", search: { tab, draft } });
  const write = () => void navigate({ to: "/articles", search: { tab: "drafts", new: true } });
  return (
    <XColumn
      header={
        <XTitle
          title="Articles"
          actions={
            <button
              type="button"
              aria-label="Write"
              className="grid size-9 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
              onClick={write}
            >
              <PenLine className="size-5" />
            </button>
          }
        />
      }
    >
      {access === false ? (
        <div className="flex flex-col gap-1 border-b border-white/[0.12] px-4 py-4">
          <p className="text-[17px] font-bold">Publish Articles</p>
          <p className="text-[15px] text-[#71767b]">
            Publish long-form articles with rich formatting directly on 𝕏 (web only).
          </p>
          <XLink
            href={UPGRADE_URL}
            className="pt-1 text-[15px] font-bold text-[#1d9bf0] hover:underline"
          >
            Upgrade to unlock
          </XLink>
        </div>
      ) : null}
      {isElectron ? null : (
        <p className="border-b border-white/[0.12] px-4 py-3 text-[15px] text-[#71767b]">
          Articles open in the desktop app. Writing works here and saves as an Xtend draft. Publish
          now needs X's editor, which runs in the desktop. Queue and Schedule still work through the
          X API.
        </p>
      )}
      {mine.map((d) => (
        <Row
          key={d.id}
          tag={badge(
            d.status === "posted"
              ? "Published"
              : d.status === "queued" || d.status === "posting"
                ? "Queued"
                : d.status === "failed"
                  ? "Failed"
                  : "Draft",
            d.status === "posted"
              ? "published"
              : d.status === "queued" || d.status === "posting"
                ? "queued"
                : "draft",
          )}
          when={
            d.status === "queued" && d.scheduledAt !== null
              ? `${fmtWhen(d.scheduledAt)} · ${articleWords(d.body).toLocaleString("en")} words`
              : d.status === "posted" && d.postedAt !== null
                ? fmtWhen(d.postedAt)
                : `Saved ${fmtWhen(d.updatedAt)}`
          }
          title={d.title}
          preview={previewOf(d.body)}
          onOpen={() => open(d.id)}
        />
      ))}
      {onX.map((a) => (
        <Row
          key={a.id}
          tag={badge("On X", "x")}
          when={a.modifiedAt === null ? "" : fmtWhen(a.modifiedAt)}
          title={a.title}
          preview={a.preview}
          onOpen={() => void navigate({ to: "/articles", search: { tab, x: a.id } })}
        />
      ))}
      {mine.length === 0 && onX.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-8 py-12 text-center">
          <p className="text-[31px] leading-9 font-extrabold">{EMPTY[tab]}</p>
          {tab === "drafts" ? (
            <>
              <p className="text-[15px] text-[#71767b]">This is where you write</p>
              <p className="text-[15px] text-[#71767b]">Continue a draft or create a new Article</p>
              <button
                type="button"
                className="mt-3 h-10 cursor-pointer rounded-full bg-foreground px-5 text-[15px] font-bold text-background"
                onClick={write}
              >
                Write
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </XColumn>
  );
}

/** What Copy to Xtend will leave out of this Article, said before the copy, or nothing. */
function LeftOut({ blocks }: { readonly blocks: ReadonlyArray<EngineArticleBlock> }) {
  const { images, blocks: other } = copyLeavesOut(blocks);
  if (images === 0 && other === 0) return null;
  const parts = [
    images === 0 ? null : `${images} ${images === 1 ? "image" : "images"}`,
    other === 0
      ? null
      : `${other} ${other === 1 ? "block" : "blocks"} like posts, dividers or LaTeX`,
  ].filter((p) => p !== null);
  return (
    <p className="border-b border-white/[0.12] px-4 py-2 text-[13px] text-warning-foreground">
      Copy to Xtend leaves out {parts.join(" and ")}: an Xtend draft has no place for them yet.
    </p>
  );
}

/**
 * An Article the user keeps on x.com, read off X's own preview of it: shown read-only, since
 * Xtend never types into X's editor for it. "Copy to Xtend" makes an Xtend draft of it.
 */
function XArticleView({ id, tab }: { readonly id: string; readonly tab: Tab }) {
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const create = useAtomSet(createDraftAtom, { mode: "promiseExit" });
  const [error, setError] = useState<string | null>(null);
  const preview = `${ARTICLES_URL}/edit/${id}/preview`;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine to X's own preview of this Article while it shows.
  useEffect(() => void xGo(preview), [preview]);
  const article: EngineXArticle | undefined = engine.xArticles.byId.get(id);
  const back = () => void navigate({ to: "/articles", search: { tab } });
  const copy = async (a: EngineXArticle) => {
    const exit = await create({
      kind: "article",
      title: a.title,
      body: fromReaderBlocks(a.blocks ?? []),
    });
    if (Exit.isFailure(exit)) return setError(failText(exit.cause));
    void navigate({ to: "/articles", search: { tab: "drafts", draft: exit.value.id } });
  };
  return (
    <XColumn
      header={
        <XTitle
          title={article?.title || "Article"}
          detail="On X · read only"
          onBack={back}
          actions={
            article?.blocks == null ? undefined : (
              <button
                type="button"
                className="h-8 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background"
                onClick={() => void copy(article)}
              >
                Copy to Xtend
              </button>
            )
          }
        />
      }
    >
      {error === null ? null : (
        <p className="px-4 pt-3 text-[13px] text-error-foreground">{error}</p>
      )}
      {article?.blocks == null ? null : <LeftOut blocks={article.blocks} />}
      {article?.blocks == null ? (
        <XEmpty key={id} empty="Loading the Article from X." onReopen={() => void xGo(preview)} />
      ) : (
        <>
          {article.coverUrl === null ? null : (
            <img src={article.coverUrl} alt="" className="aspect-[5/2] w-full object-cover" />
          )}
          <h1 className="px-4 pt-4 text-[31px] leading-9 font-extrabold break-words">
            {article.title}
          </h1>
          <ArticleBody blocks={article.blocks} />
          <p className="px-4 pb-6 text-[13px] text-[#71767b]">
            Edit it in X's own editor:{" "}
            <XLink href={`${ARTICLES_URL}/edit/${id}`} className="text-[#1d9bf0] hover:underline">
              open on X
            </XLink>
            , or copy it into an Xtend draft.
          </p>
        </>
      )}
    </XColumn>
  );
}

function ArticlesScreen() {
  const search = Route.useSearch();
  const tab = useSection("/articles");
  const navigate = useNavigate();
  if (search.x !== undefined) return <XArticleView key={search.x} id={search.x} tab={tab} />;
  if (search.draft !== undefined || search.new === true)
    return (
      <ArticleEditor
        draftId={search.draft}
        onOpen={(draft) => void navigate({ to: "/articles", search: { tab, draft } })}
        onBack={() => void navigate({ to: "/articles", search: { tab } })}
      />
    );
  return <ArticlesHome tab={tab} />;
}

const TABS = new Set<string>(["drafts", "queued", "published"]);

export const Route = createFileRoute("/articles")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { tab?: Tab; draft?: string; new?: true; x?: string } => ({
    ...(typeof s.tab === "string" && TABS.has(s.tab) ? { tab: s.tab as Tab } : {}),
    ...(typeof s.draft === "string" ? { draft: s.draft } : {}),
    // `?new=1` parses as the number 1.
    ...(s.new === true || s.new === 1 || s.new === "1" ? { new: true as const } : {}),
    ...(typeof s.x === "string" && /^\d{1,25}$/.test(s.x) ? { x: s.x } : {}),
  }),
  component: ArticlesScreen,
});
