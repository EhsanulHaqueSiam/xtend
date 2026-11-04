/**
 * Mock X's Articles (bundle.TwitterArticles): the user's Articles in X's GraphQL shapes, X's
 * Articles page and its editor, and X's "Page not found" for an account its claims give no
 * article composer (no Premium). The page script (client.ts) drives the editor's controls; what
 * they change comes back here as X's own mutations.
 */

type Json = Record<string, unknown>;

const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export interface MockArticle {
  readonly id: string;
  title: string;
  /** What X's editor holds: its Draft.js blocks' types and text. */
  blocks: Array<{ readonly type: string; readonly text: string }>;
  lifecycle: "Draft" | "Published";
  coverMediaId: string | null;
  postId: string | null;
  caption: string | null;
  replies: string | null;
  readonly modifiedAt: number;
}

const TAGS: Readonly<Record<string, string>> = {
  "header-one": "h1",
  "header-two": "h2",
  blockquote: "blockquote",
  "unordered-list-item": "li",
  "ordered-list-item": "li",
};
/** The blocks as X's editor draws them, for its page. */
const html = (blocks: MockArticle["blocks"]) =>
  blocks.map((b) => `<${TAGS[b.type] ?? "p"}>${esc(b.text)}</${TAGS[b.type] ?? "p"}>`).join("");

/** X's draft list: one made-up draft the user started on x.com, and one published Article. */
export function createMockArticles() {
  const articles: Array<MockArticle> = [
    {
      id: "1900000000000000001",
      title: "Notes from the founders dinner",
      blocks: [
        { type: "header-one", text: "Pricing" },
        { type: "unstyled", text: "Hiring the first support person, when to stop." },
      ],
      lifecycle: "Draft",
      coverMediaId: null,
      postId: null,
      caption: null,
      replies: null,
      modifiedAt: 1_793_491_200,
    },
    {
      id: "1900000000000000002",
      title: "What 40 churn interviews had in common",
      blocks: [{ type: "unstyled", text: "Every one of them mentioned onboarding." }],
      lifecycle: "Published",
      coverMediaId: null,
      postId: "1950000000000000777",
      caption: null,
      replies: null,
      modifiedAt: 1_793_404_800,
    },
  ];
  let next = 3;

  /** An Article as X's ArticleEntity: its body a Draft.js content state of its paragraphs. */
  const entity = (a: MockArticle, withBody: boolean): Json => ({
    __typename: "ArticleEntity",
    rest_id: a.id,
    title: a.title,
    preview_text: a.blocks
      .map((b) => b.text)
      .join(" ")
      .slice(0, 120),
    lifecycle_state: { lifecycle: a.lifecycle, modified_at_secs: a.modifiedAt },
    metadata: {
      modified_at_secs: a.modifiedAt,
      tweet_results:
        a.postId === null ? {} : { result: { __typename: "Tweet", rest_id: a.postId } },
    },
    ...(a.coverMediaId === null
      ? {}
      : {
          cover_media: {
            media_id: a.coverMediaId,
            media_info: {
              __typename: "ApiImage",
              original_img_url: `https://pbs.twimg.com/media/${a.coverMediaId}.jpg`,
            },
          },
        }),
    ...(withBody
      ? {
          content_state: {
            blocks: a.blocks.map((b, i) => ({
              key: `b${i}`,
              ...b,
              inlineStyleRanges: [],
              entityRanges: [],
              data: {},
            })),
            entityMap: [],
          },
        }
      : {}),
  });

  const find = (id: unknown) => articles.find((a) => a.id === id);

  return {
    articles,
    find,
    /** X's answer to one of its Articles reads, or undefined for any other operation. */
    respond: (op: string, variables: Json, premium: boolean): Json | undefined => {
      if (op === "ArticleEntitiesSlice") {
        const lifecycle = variables.lifecycle === "Published" ? "Published" : "Draft";
        return {
          data: {
            user: {
              result: {
                __typename: "User",
                articles_article_mixer_slice: {
                  items: premium
                    ? articles
                        .filter((a) => a.lifecycle === lifecycle)
                        .map((a) => ({ article_entity_results: { result: entity(a, false) } }))
                    : [],
                  slice_info: {},
                },
              },
            },
          },
        };
      }
      if (op === "ArticleEntityResultByRestId") {
        const a = find(variables.articleEntityId);
        return {
          data: {
            article_result_by_rest_id:
              a === undefined || !premium ? {} : { result: entity(a, true) },
          },
        };
      }
      return undefined;
    },
    /** X's Articles mutations as its editor sends them, or undefined for any other. */
    write: (name: string, input: Json): Json | undefined => {
      const a = find(input.articleEntityId ?? input.article_entity);
      switch (name) {
        case "ArticleEntityDraftCreate": {
          const created: MockArticle = {
            id: `19000000000000000${String(next++).padStart(2, "0")}`,
            title: String(input.title ?? ""),
            blocks: [],
            lifecycle: "Draft",
            coverMediaId: null,
            postId: null,
            caption: null,
            replies: null,
            modifiedAt: 1_793_577_600,
          };
          articles.unshift(created);
          return {
            data: {
              articleentity_create_draft: {
                article_entity_results: { result: entity(created, true) },
              },
            },
          };
        }
        case "ArticleEntityUpdateTitle":
          if (a !== undefined) a.title = String(input.title ?? "");
          return { data: { articleentity_update_title: a === undefined ? {} : entity(a, false) } };
        case "ArticleEntityUpdateContent":
          if (a !== undefined)
            a.blocks =
              ((input.content_state as Json | undefined)?.blocks as
                | MockArticle["blocks"]
                | undefined) ?? [];
          return {
            data: { articleentity_update_content_state: a === undefined ? {} : entity(a, false) },
          };
        case "ArticleEntityUpdateCoverMedia":
          if (a !== undefined)
            a.coverMediaId = String((input.coverMedia as Json | undefined)?.media_id ?? "") || null;
          return {
            data: { articleentity_update_cover_media: a === undefined ? {} : entity(a, false) },
          };
        case "ArticleEntityPublish":
          if (a !== undefined) {
            a.lifecycle = "Published";
            a.postId = `19500000000000000${a.id.slice(-2)}`;
            a.caption = typeof input.tweetText === "string" ? input.tweetText : null;
            a.replies = String((input.conversationControl as Json | undefined)?.mode ?? "") || null;
          }
          return {
            data: {
              articleentity_publish: {
                article_entity_results: { result: a === undefined ? {} : entity(a, false) },
              },
            },
          };
      }
      return undefined;
    },
  };
}

export type MockArticles = ReturnType<typeof createMockArticles>;

const notFound = `<div class="empty" data-testid="error-detail"><h1>Hmm...this page doesn’t exist. Try searching for something else.</h1><a href="/explore" role="button">Search</a></div>`;

/**
 * X's Articles pages. `/compose/articles` lists the Drafts (X's default tab; shortcut: mock X
 * also asks for Published on load, where X asks once its tab is pressed); `/edit/<id>` is X's
 * editor, `/edit/<id>/preview` X's read-only preview. Without Premium every one is X's Not found.
 */
export function articlesPage(
  articles: MockArticles,
  premium: boolean,
  path: string,
): {
  readonly title: string;
  readonly requests: ReadonlyArray<{ op: string; variables: Json }>;
  readonly html: string;
} {
  if (!premium) return { title: "Page not found / X", requests: [], html: notFound };
  const parts = path.split("/").filter(Boolean);
  const [, , edit, id, preview] = parts;
  const a = edit === "edit" ? articles.find(id) : undefined;
  if (a !== undefined && preview === "preview")
    return {
      title: "Preview / X",
      requests: [{ op: "ArticleEntityResultByRestId", variables: { articleEntityId: a.id } }],
      html: `<div class="bar"><h2>${esc(a.title)}</h2></div><div class="empty">${html(a.blocks)}</div>`,
    };
  if (a !== undefined)
    return {
      title: "Article / X",
      requests: [{ op: "ArticleEntityResultByRestId", variables: { articleEntityId: a.id } }],
      // X's editor: its app bar with Preview and Publish, the cover, the title, then its composer.
      html: `<div data-mock-article="${a.id}"><div class="bar"><span data-save>${a.title === "" ? "" : "Saved"}</span><a href="/compose/articles/edit/${a.id}/preview" role="button">Preview</a><button type="button" data-article-publish aria-disabled="true" disabled>Publish</button></div>
<div data-article-cover><p class="muted">We recommend an image with a 5:2 aspect ratio for best results.</p><input type="file" accept="image/*"></div>
<textarea placeholder="Add a title" name="Article Title" maxlength="100">${esc(a.title)}</textarea>
<div data-testid="composer"><div role="toolbar"><button type="button" aria-label="Bold">B</button><button type="button" aria-label="Italicize">I</button></div><div contenteditable="true" role="textbox" data-placeholder="Start writing">${html(a.blocks)}</div></div></div>`,
    };
  return {
    title: "Articles / X",
    requests: [
      {
        op: "ArticleEntitiesSlice",
        variables: { userId: "1700000000000000001", lifecycle: "Draft" },
      },
      {
        op: "ArticleEntitiesSlice",
        variables: { userId: "1700000000000000001", lifecycle: "Published" },
      },
    ],
    html: `<div class="bar"><h2>Articles</h2><button type="button" aria-label="create" data-article-create>✎</button></div>
<nav role="tablist" class="tabs"><a role="tab" aria-selected="true" tabindex="0">Drafts</a><a role="tab" aria-selected="false" tabindex="0">Published</a></nav>
<div data-list>${articles.articles
      .filter((x) => x.lifecycle === "Draft")
      .map(
        (x) =>
          `<a href="/compose/articles/edit/${x.id}" class="row"><b>${esc(x.title || "Untitled")}</b></a>`,
      )
      .join("")}</div>`,
  };
}
