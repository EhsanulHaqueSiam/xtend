import type {
  EngineBatch,
  EngineCommunity,
  EngineGame,
  EngineGif,
  EngineList,
  EngineModule,
  EngineNotification,
  EnginePost,
  EngineTrend,
  EngineUser,
} from "@xtend/contracts";

import { articlesPage } from "./articles.ts";
import { chatPage } from "./chat.ts";
import { grokHistoryPage, grokPage } from "./grok.ts";
import { settingsPage } from "./settings.ts";
import {
  type GraphqlRequest,
  INSPIRATION_FILTERS,
  inspirationTimelineId,
  type MockState,
  quotesQuery,
  radarRange,
} from "./state.ts";

/**
 * Mock X's pages: per x.com route, the GraphQL calls X's page makes and the markup it draws from
 * them, with the test ids and labels Xtend's engine scripts, overlay and bench look for. Wording
 * follows X's web app as Mobbin recorded it (docs/operations/x-parity-mobbin.md).
 */

export const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const compact = (n: number | null) =>
  n === null
    ? ""
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 10_000
        ? `${Math.round(n / 1_000)}K`
        : String(n);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A row of tabs as X draws them: links, or Home's buttons that switch its timeline. */
const tabs = (
  label: string,
  items: ReadonlyArray<{ label: string; href?: string; tab?: string; on: boolean }>,
) =>
  `<nav role="tablist" aria-label="${esc(label)}" class="tabs">${items
    .map(
      (t) =>
        `<${t.href === undefined ? "div" : `a href="${esc(t.href)}"`} role="tab" aria-selected="${t.on}" ${t.tab === undefined ? "" : `data-home-tab="${esc(t.tab)}"`} tabindex="0"><span>${esc(t.label)}</span></${t.href === undefined ? "div" : "a"}>`,
    )
    .join("")}</nav>`;

const header = (title: string, back = true) =>
  `<div class="bar">${back ? `<button data-testid="app-bar-back" aria-label="Back">←</button>` : ""}<h2 role="heading">${esc(title)}</h2></div>`;

const avatar = (src: string | null, handle: string) =>
  `<img class="avatar" alt="@${esc(handle)}" src="${esc(src ?? "")}">`;

export function pollMarkup(p: EnginePost) {
  const poll = p.poll!;
  const total = poll.choices.reduce((n, c) => n + c.votes, 0);
  const results = poll.choices
    .map(
      (c) =>
        `<div class="result"><span>${esc(c.label)}</span><span>${total === 0 ? 0 : Math.round((c.votes / total) * 100)}%</span></div>`,
    )
    .join("");
  // An open poll the user has not voted in is X's radios; otherwise its results.
  const open = !poll.final && poll.voted === null;
  return `<div data-testid="cardPoll">${
    open
      ? `<div role="radiogroup">${poll.choices
          .map(
            (c, i) =>
              `<div role="radio" tabindex="0" aria-checked="false" data-vote="${p.postId}:${i + 1}">${esc(c.label)}</div>`,
          )
          .join("")}</div>`
      : results
  }<div class="muted">${compact(total)} votes</div></div>`;
}

/** The action row X draws under a post; each button by X's test id, turned when pressed. */
const actions = (
  p: EnginePost,
) => `<div role="group" class="actions" aria-label="${p.metrics.replies} replies, ${p.metrics.reposts} reposts, ${p.metrics.likes} likes">
  <button data-testid="reply" data-post="${p.postId}" aria-label="${p.metrics.replies} Replies. Reply">💬 <span>${compact(p.metrics.replies)}</span></button>
  <button data-testid="${p.reposted ? "unretweet" : "retweet"}" data-post="${p.postId}" aria-haspopup="menu" aria-expanded="false" aria-label="Repost">🔁 <span data-count="reposts">${compact(p.metrics.reposts)}</span></button>
  <button data-testid="${p.liked ? "unlike" : "like"}" data-post="${p.postId}" aria-label="Like">♥ <span data-count="likes">${compact(p.metrics.likes)}</span></button>
  <a href="/${esc(p.author.handle)}/status/${p.postId}/analytics" aria-label="View post analytics">📊 <span>${compact(p.metrics.views)}</span></a>
  <button data-testid="${p.bookmarked ? "removeBookmark" : "bookmark"}" data-post="${p.postId}" aria-label="Bookmark">🔖 <span data-count="bookmarks">${compact(p.metrics.bookmarks)}</span></button>
  <button aria-label="Share post" aria-haspopup="menu" aria-expanded="false" data-menu="share:${p.postId}">⤴</button>
</div>`;

/**
 * One post as X's `article`: its timestamp links to the post (to its edit history once edited),
 * the quoted post inside it carries a time but no such link, as on x.com.
 */
function article(p: EnginePost, state: MockState, opts: { focal?: boolean; sort?: string } = {}) {
  const href = `/${p.author.handle}/status/${p.postId}${p.edits.length > 1 ? "/history" : ""}`;
  const quoted = p.quotedId === null ? undefined : state.post(p.quotedId);
  const context =
    p.context === null
      ? ""
      : `<div data-testid="socialContext" class="muted">${esc(p.context.text)}</div>`;
  const replying =
    p.replyingTo.length === 0
      ? ""
      : `<div class="muted">Replying to ${p.replyingTo.map((h) => `<a href="/${esc(h)}">@${esc(h)}</a>`).join(" ")}</div>`;
  const media = p.media
    .map(
      (m) =>
        `<div data-testid="tweetPhoto"><img alt="${esc(m.altText ?? "Image")}" src="${esc(m.url)}"></div>`,
    )
    .join("");
  const card =
    p.card === null
      ? ""
      : `<div data-testid="card.wrapper"><a href="${esc(p.card.url)}" rel="noopener" target="_blank"><div>${esc(p.card.domain ?? "")}</div><div>${esc(p.card.title)}</div></a></div>`;
  const translation =
    p.translation === null
      ? ""
      : `<div class="muted">Translated from ${esc(new Intl.DisplayNames(["en"], { type: "language" }).of(p.translation.from) ?? p.translation.from)}</div><button aria-label="Show original" data-toggle-translation>Show original</button>`;
  const text = p.translation?.text ?? p.text;
  const quote =
    quoted === undefined
      ? ""
      : `<div role="link" class="quote" tabindex="0" data-href="/${esc(quoted.author.handle)}/status/${quoted.postId}"><div data-testid="User-Name"><span>${esc(quoted.author.name)}</span> <span>@${esc(quoted.author.handle)}</span> · <time datetime="${quoted.createdAt}">${shortDate(quoted.createdAt)}</time></div><div data-testid="tweetText">${esc(quoted.text)}</div></div>`;
  const note =
    p.note === null ? "" : `<div data-testid="birdwatch-pivot" class="note">${esc(p.note)}</div>`;
  const sort =
    opts.sort === undefined
      ? ""
      : `<div class="sort"><div><button aria-haspopup="menu" aria-expanded="false" data-menu="sort:${p.postId}">${esc(opts.sort)}</button></div><a href="/${esc(p.author.handle)}/status/${p.postId}/quotes">View quotes ›</a></div>`;
  return `<article data-testid="tweet" role="article" tabindex="${opts.focal === true ? "-1" : "0"}" aria-labelledby="t${p.postId}">
  ${context}
  <div class="row"><div data-testid="Tweet-User-Avatar"><a href="/${esc(p.author.handle)}">${avatar(p.avatarUrl, p.author.handle)}</a></div>
  <div class="body">
    <div class="head"><div data-testid="User-Name"><a href="/${esc(p.author.handle)}"><span>${esc(p.author.name)}</span></a> <a href="/${esc(p.author.handle)}"><span>@${esc(p.author.handle)}</span></a> · <a href="${esc(href)}"><time datetime="${p.createdAt}">${shortDate(p.createdAt)}</time></a></div>
    <button aria-label="Grok actions" data-mock-grok-explain="${esc(p.author.handle)}/status/${p.postId}">⌀</button><button data-testid="caret" aria-label="More" aria-haspopup="menu" aria-expanded="false" data-menu="post:${p.postId}">…</button></div>
    ${replying}
    <div data-testid="tweetText" lang="en" id="t${p.postId}">${esc(text)}</div>
    ${translation}${media}${card}${p.poll === null ? "" : pollMarkup(p)}${quote}${note}
    ${sort}
    ${actions(p)}
  </div></div>
</article>`;
}

/** A person as X lists them (search People, Who to follow, a List's members), with X's button. */
function userCell(u: EngineUser, button: "follow" | "subscribe" = "follow") {
  const own =
    button === "subscribe"
      ? `<button data-testid="${u.userId}-subscribe" aria-label="Subscribe to @${esc(u.handle)}">Subscribe</button>`
      : followButton(u);
  return `<div data-testid="UserCell" role="button" tabindex="0" class="user">
  <a href="/${esc(u.handle)}">${avatar(u.avatarUrl, u.handle)}</a>
  <div class="body"><div class="head"><div><a href="/${esc(u.handle)}"><span>${esc(u.name)}</span></a><div class="muted">@${esc(u.handle)}${u.followsYou ? ` <span data-testid="userFollowIndicator">Follows you</span>` : ""}</div></div><div>${own}</div></div>
  <div>${esc(u.bio)}</div></div>
</div>`;
}

const followButton = (u: EngineUser) =>
  u.youFollow
    ? `<button data-testid="${u.userId}-unfollow" aria-label="Following @${esc(u.handle)}" data-handle="${esc(u.handle)}">Following</button>`
    : `<button data-testid="${u.userId}-follow" aria-label="Follow @${esc(u.handle)}" data-handle="${esc(u.handle)}">Follow</button>`;

const trendRow = (t: EngineTrend, i: number) =>
  `<div data-testid="trend" data-trend="${esc(t.name)}" role="link" tabindex="0" data-href="${esc(new URL(t.url).pathname + new URL(t.url).search)}"><div class="muted">${i + 1} · ${esc(t.context ?? "Trending")}</div><div style="font-weight:700"><span>${esc(t.name)}</span></div><button data-testid="caret" aria-label="More" aria-haspopup="menu" aria-expanded="false" data-menu="trend:${esc(t.name)}">…</button></div>`;

const notificationRow = (n: EngineNotification, state: MockState) =>
  n.kind === "post"
    ? state.post(n.postIds[0] ?? "") === undefined
      ? ""
      : article(state.post(n.postIds[0]!)!, state)
    : `<article data-testid="notification" tabindex="0"><div class="faces">${n.users.map((u) => avatar(u.avatarUrl, u.handle)).join("")}</div><div>${esc(n.text)}</div>${n.postIds
        .map((id) => state.post(id))
        .map((p) => (p === undefined ? "" : `<div class="muted">${esc(p.text)}</div>`))
        .join("")}</article>`;

/** A row of X's Lists page; on Your Lists X's Pin (ListWithPin), which X gives a test id. */
const listRow = (l: EngineList) =>
  `<div data-testid="listCell" role="link" tabindex="0" data-href="/i/lists/${l.listId}"><div><span>${esc(l.name)}</span>${l.isPrivate ? `<span aria-label="Private List">🔒</span>` : ""}</div><div class="muted">${compact(l.members)} members · ${compact(l.followers)} followers${l.owner === null ? "" : ` including @${esc(l.owner.handle)}`}</div>${l.button === "pin" ? `<button data-testid="list-icon-button" aria-label="${l.pinned === true ? "Unpin List" : "Pin List"}" data-list-pin="${l.listId}">📌</button>` : ""}</div>`;

/** X's membership button in a Community's header, labelled with what pressing it does. */
const joinButton = (c: EngineCommunity, requested: boolean) => {
  const label =
    c.role !== null && c.role !== "NonMember"
      ? "Joined"
      : requested
        ? "Requested"
        : c.joinPolicy === "Open"
          ? "Join"
          : "Ask to join";
  return `<button data-community-join="${c.communityId}" aria-label="${esc(`${label} ${c.name}`)}">${label}</button>`;
};

/** X's search of Communities: its tabs, each its own page, x.com/i/communities/<page>?q=. */
const COMMUNITIES_SEARCH_TABS = [
  { page: "suggested", label: "Communities", op: "CommunitiesSearchQuery" },
  { page: "top", label: "Top", op: "GlobalCommunitiesPostSearchTimeline" },
  { page: "latest", label: "Latest", op: "GlobalCommunitiesLatestPostSearchTimeline" },
] as const;

/** A Community's tabs: X switches Top, Latest and Media in place on one URL; About is its own page. */
const COMMUNITY_TABS = [
  { path: "", label: "Top" },
  { path: "", label: "Latest" },
  { path: "", label: "Media" },
  { path: "/about", label: "About" },
] as const;

/**
 * A page's list body: its posts in X's order, with what the capture lists around them, or the
 * tiles of X's GIF search.
 */
export const postsOf = (b: EngineBatch | null, state: MockState) =>
  b === null
    ? ""
    : b.order
        .flatMap((id) => {
          const p = b.posts.find((post) => post.postId === id);
          if (p !== undefined) return [article(p, state)];
          const m = b.modules.find((module) => module.id === id);
          // A titled box of posts (Explore's Posts For You) is its header over the posts after it.
          if (m?.userIds.length === 0) return [`<h2>${esc(m.title)}</h2>`];
          return m === undefined ? [] : [whoToFollow(m, b)];
        })
        .join("") + (b.gifs ?? []).map(gifTile).join("");
/** X's GIF tile: named by its alt text (X's own ends in "GIF"), its picture a CSS background, no id of its own. */
const gifTile = (g: EngineGif) =>
  `<button><div data-testid="gifSearchGifImage" aria-label="${esc(g.altText ?? "GIF")}" style="display:inline-block;width:180px;height:240px;background-image:url(&quot;${esc(g.url)}&quot;)"></div></button>`;
/**
 * X's editor in its box: X caps the box's height (scrolling past it) unless its own gate lets the
 * account bold and italicize, which is how Xtend tells, as live X may never send GetUserClaims.
 */
const editor = (state: MockState, placeholder: string) =>
  `<div data-testid="tweetTextarea_0RichTextInputContainer" style="${state.formats ? "min-height: 24px" : "max-height: 720px; overflow-y: auto"}"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" aria-label="Post text" data-placeholder="${placeholder}"></div></div>`;

/** X's composer toolbar: its GIF button opens X's GIF search, then `post` (Post or Reply). */
// X's audience button ("Everyone"), as live only on /compose/post, never Home's composer; kept out
// of the flow so the page keeps its height.
const AUDIENCE =
  '<button aria-label="Choose audience" style="position: absolute; top: 0; right: 0"><span>Everyone</span></button>';
const toolBar = (post: string, audience = false) =>
  `<div data-testid="toolBar" style="position: relative">${audience ? AUDIENCE : ""}<button data-testid="gifSearchButton" aria-label="Add a GIF">GIF</button>${post}</div>`;
/** X's Who to follow among a timeline's posts: header, people with Follow, Show more. */
const whoToFollow = (m: EngineModule, b: EngineBatch) =>
  `<aside aria-label="${esc(m.title)}"><h2>${esc(m.title)}</h2>${m.userIds
    .flatMap((id) => b.users.find((u) => u.userId === id) ?? [])
    .map((u) => userCell(u))
    .join("")}<a href="/i/connect_people">Show more</a></aside>`;
const peopleOf = (
  b: EngineBatch | null,
  button: "follow" | "subscribe" = "follow",
  rows = Infinity,
) =>
  b === null
    ? ""
    : b.people
        .flatMap((id) => b.users.find((u) => u.userId === id) ?? [])
        .slice(0, rows)
        .map((u) => userCell(u, button))
        .join("");
/**
 * X's Follow page keeps only the rows near its scroll; the mock draws the first three, so a press
 * for a person further down goes to their profile, as Xtend's engine does on x.com.
 */
const ROWS_NEAR_SCROLL = 3;

const DAY_MS = 86_400_000;
/** X's analytics tabs, and the range buttons each page draws, in X's order. */
const ANALYTICS_TABS = [
  ["overview", "Overview"],
  ["audience", "Audience"],
  ["content", "Content"],
  ["video", "Video"],
  ["live", "Live"],
  ["spaces", "Spaces"],
] as const;
const ANALYTICS_RANGES: Readonly<Record<string, ReadonlyArray<string>>> = {
  overview: ["7D", "2W", "4W", "3M", "1Y"],
  content: ["7D", "2W", "4W", "3M"],
  video: ["7D", "2W", "4W", "3M", "1Y"],
  audience: ["7D", "28D", "3M"],
};
const ANALYTICS_DAYS: Readonly<Record<string, number>> = {
  "7D": 7,
  "2W": 14,
  "4W": 28,
  "28D": 28,
  "3M": 90,
  "1Y": 365,
};
/** The engagements X's overview sums. */
const ANALYTICS_ENGAGING = ["Bookmark", "Likes", "ProfileVisits", "Retweets", "Replies", "Share"];

interface Route {
  readonly title: string;
  readonly requests: ReadonlyArray<GraphqlRequest>;
  /** Which request pages on scroll, by its index; none for a page that is one answer. */
  readonly paged?: number | undefined;
  /** X's REST reads the page makes beside its GraphQL ones, by URL. */
  readonly rest?: ReadonlyArray<string>;
  readonly render: (batches: ReadonlyArray<EngineBatch | null>) => string;
  /** Where X's router sends the path instead, replacing it, as X's Redirect does. */
  readonly redirect?: string;
  /** The rows a next page appends, for a page that lists no posts of its own (X's queues). */
  readonly more?: (batch: EngineBatch | null) => string;
}

const RESERVED = new Set([
  "home",
  "explore",
  "search",
  "notifications",
  "messages",
  "i",
  "compose",
  "settings",
]);
const SEARCH_TABS = [
  { f: null, product: "Top", label: "Top" },
  { f: "live", product: "Latest", label: "Latest" },
  { f: "user", product: "People", label: "People" },
  { f: "media", product: "Media", label: "Media" },
  { f: "list", product: "Lists", label: "Lists" },
] as const;
const PROFILE_TABS = [
  { path: "", op: "UserTweets", label: "Posts" },
  { path: "/with_replies", op: "UserTweetsAndReplies", label: "Replies" },
  { path: "/reposts", op: "UserRepostsTimeline", label: "Reposts" },
  // Only for a creator who offers Subscriptions.
  { path: "/subs", op: "UserSuperFollowTweets", label: "Subs" },
  { path: "/highlights", op: "UserHighlightsTweets", label: "Highlights" },
  { path: "/media", op: "UserMedia", label: "Media" },
] as const;
/** A profile's people pages, as X's tabs list them; the user's own has no Followers you know. */
const PEOPLE_TABS = [
  { path: "verified_followers", op: "BlueVerifiedFollowers", label: "Verified Followers" },
  { path: "followers_you_follow", op: "FollowersYouKnow", label: "Followers you know" },
  { path: "followers", op: "Followers", label: "Followers" },
  { path: "following", op: "Following", label: "Following" },
] as const;
const SORTS = { relevance: "Relevant", recency: "Recent", likes: "Likes" } as const;
const MODES = { relevance: "Relevance", recency: "Recency", likes: "Likes" } as const;

/** A game's state in a line, as X's cards and strip say it: "Final", "LIVE Q3 04:12", the day. */
const gameState = (g: EngineGame) =>
  g.status === "COMPLETED"
    ? "Final"
    : g.status === "IN_PROGRESS"
      ? `LIVE Q${g.period ?? 1} ${g.clock ?? ""}`
      : shortDate(g.startsAt ?? "");
const gameSides = (g: EngineGame) =>
  [g.away, g.home]
    .map((t) => `<span>${esc(t.abbreviation ?? "")} ${t.points ?? ""}</span>`)
    .join("");
/** X's tabs on a game's page, switched in place on its one URL. */
const GAME_TABS = ["Top", "Latest", "Highlights", "Stats", "Plays", "Chat"] as const;

/**
 * A full-page dialog X opens as its own route (Report, Send via Chat, the composer). In X's
 * compact layout (`compact`) the route is a page: its title in the app bar beside Back.
 */
const routeDialog = (title: string, body: string, compact = false) =>
  compact
    ? `${header(title)}<div class="route">${body}</div>`
    : `<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="dialog route"><div class="bar"><button data-testid="app-bar-close" aria-label="Close">✕</button><h2 id="dialog-title">${esc(title)}</h2></div>${body}</div>`;

/**
 * X's Radar pages (ondemand.Insights): without Premium, X's upsell and no call, as on x.com. With
 * it, the list (or, for an account X allows one query, that query's page), a query's page with
 * its Posts count and Top posts, and the new-query form, whose Delete and Submit client.ts drives.
 */
function radarPage(state: MockState, page: string | undefined): Route {
  const radar = state.radar;
  if (!radar.premium)
    return {
      title: "Radar / X",
      requests: [],
      render: () =>
        `${header("Radar")}<div class="empty"><h1>Be the very first to spot trends with Radar</h1><p>Introducing the most powerful search tool on X.</p><p>Monitor keywords, visualize trend activity, and filter conversations. In real-time.</p><a href="/i/premium_sign_up">Subscribe to Premium</a>${[
          ["Monitor keywords", "Focus on any topic using advanced search capability."],
          [
            "Visualize trends",
            "Track conversations with daily activity graphs from the past 3 days.",
          ],
          ["Real-time metrics", "Get immediate stats on post counts from your queries."],
        ]
          .map(([t, d]) => `<div><b>${t}</b><p>${d}</p></div>`)
          .join("")}</div>`,
    };
  const r = (op: string, variables: Record<string, unknown>): GraphqlRequest => ({ op, variables });
  const { from, to, since } = radarRange();
  const counts = (id: string) =>
    r("usePostCountQuery", {
      from_time: from,
      granularity: "Day",
      id,
      timezone_offset: 0,
      to_time: to,
      include_unique_users: false,
      include_impressions: false,
      include_total_posts: false,
    });
  const config = r("insightsConfigQuery", {});
  const list = r("insightsListContextQuery", { previewsEnabled: radar.limit > 1 });
  const total = (b: EngineBatch | null | undefined) =>
    (b?.radarCounts ?? []).reduce((n, d) => n + (d.count ?? 0), 0).toLocaleString("en");
  const title = (q: { readonly title: string }) => esc(q.title || "Untitled query");
  const bar = `${header("Radar")}${radar.limit > 1 ? `<a href="/i/radar">All queries</a> <a href="/i/radar/new">New query</a>` : ""}`;
  const queryPage = (id: string): Route => {
    const q = radar.queries.find((x) => x.id === id);
    return {
      title: "Radar / X",
      requests: [
        config,
        r("insightProviderGetQuery", { id }),
        counts(id),
        ...(q === undefined
          ? []
          : [
              r("postListQuery", {
                cursor: null,
                product: "Top",
                query: `${q.query} -is:retweet since:${since}`,
              }),
            ]),
      ],
      render: ([, , c, posts]) =>
        q === undefined
          ? `${bar}<div class="empty">Insight rule not found</div>`
          : `${bar}<h2>${title(q)}</h2><div>${esc(q.query)}</div><div data-radar-count>Posts <span>${total(c)}</span></div><button type="button">Top</button><button type="button">Latest</button><section data-list>${postsOf(posts ?? null, state)}</section>`,
    };
  };
  const form = (count: number) =>
    count >= radar.limit
      ? `<div class="empty"><b>You have reached the maximum number of queries</b> <a href="/i/radar">All queries</a></div>`
      : `<div class="empty" data-radar-form><h2>Create a query and let Radar track real-time updates</h2><input placeholder="$NVDA (sell OR buy)"><button type="button" aria-label="Submit" disabled data-radar-submit><svg data-icon="icon-arrow-up"></svg></button></div>`;
  if (page === "new")
    return {
      title: "Radar / X",
      requests: [config, r("insightsListContextQuery", { previewsEnabled: false })],
      render: () => `${bar}${form(radar.queries.length)}`,
    };
  if (page !== undefined) return queryPage(page);
  if (radar.queries.length === 0)
    return { title: "Radar / X", requests: [config, list], render: () => `${bar}${form(0)}` };
  if (radar.limit <= 1) {
    const only = queryPage(radar.queries[0]!.id);
    // After the page's own calls, so its render reads them where it expects.
    return { ...only, requests: [...only.requests, list] };
  }
  return {
    title: "Radar / X",
    requests: [config, list, ...radar.queries.map((q) => counts(q.id))],
    render: ([, , ...days]) =>
      `${bar}${radar.queries
        .map(
          (q, i) =>
            // X's row: a column of its title and date, its query field and its Delete, then Posts.
            `<div class="group" data-radar-row="${q.id}" data-radar-name="${title(q)}"><div><div><b>${title(q)}</b> <span>${shortDate(q.createdAt)}</span></div><div><span>${esc(q.query)}</span></div><div><button type="button" data-radar-delete="${q.id}"><svg data-icon="icon-trashcan"></svg><div>Delete</div></button></div></div><div>Posts <span>${total(days[i])}</span></div></div>`,
        )
        .join("")}`,
  };
}

/** The route for an x.com path (with its query), and Home's picked tab. */
export function route(
  state: MockState,
  pathWithQuery: string,
  homeTab: string,
  /** The page's window width, for pages X lays out by it. */
  width = 1280,
): Route {
  const url = new URL(pathWithQuery, "https://x.com");
  const q = url.searchParams;
  const parts = url.pathname.split("/").filter(Boolean);
  const [first = "", second, third, fourth] = parts;
  const r = (op: string, variables: Record<string, unknown>): GraphqlRequest => ({ op, variables });
  const lower = first.toLowerCase();

  if (lower === "i" && second === "radar" && fourth === undefined) return radarPage(state, third);
  if (lower === "i" && second === "grok" && third === "history") {
    const page = grokHistoryPage(state.grok);
    return { title: page.title, requests: [], render: () => page.html };
  }
  if (lower === "i" && second === "grok" && (third === undefined || third === "c")) {
    const page = grokPage(state.grok, url.pathname, q.get("conversation"));
    return { title: page.title, requests: [], render: () => page.html };
  }
  if (lower === "compose" && second === "articles") {
    const page = articlesPage(state.articles, state.premium, url.pathname);
    return { title: page.title, requests: page.requests, render: () => page.html };
  }
  // X's settings pages, as X's components draw them (settings.ts).
  const settings =
    lower === "settings" ? settingsPage(state.settings, url.pathname, width) : undefined;
  if (settings !== undefined)
    return { title: "Settings / X", requests: [], render: () => settings };
  if (lower === "i" && second === "chat") {
    const page = chatPage(state.chat, url.pathname);
    return { title: page.title, requests: [], render: () => page.html };
  }
  if (url.pathname === "/home") {
    const feed =
      homeTab === "following"
        ? r("HomeLatestTimeline", {
            count: 20,
            includePromotedContent: true,
            latestControlAvailable: true,
          })
        : homeTab.startsWith("tag:")
          ? r("HomeTimeline", { count: 20, tag: homeTab.slice(4) })
          : homeTab.startsWith("list:")
            ? r("ListLatestTweetsTimeline", { listId: homeTab.slice(5), count: 20 })
            : homeTab.startsWith("community:")
              ? r("CommunityTweetsTimeline", {
                  communityId: homeTab.slice("community:".length),
                  count: 20,
                  displayLocation: "Community",
                  rankingMode: "Relevance",
                  withCommunity: true,
                })
              : r("HomeTimeline", {
                  count: 20,
                  includePromotedContent: true,
                  latestControlAvailable: true,
                });
    const all = [
      { tab: "forYou", label: "For you" },
      { tab: "following", label: "Following" },
      ...state.pinnedTabs.map((t) => ({ tab: t.id, label: t.label })),
    ];
    return {
      title: "Home / X",
      requests: [r("PinnedTimelines", {}), feed],
      paged: homeTab === "forYou" || homeTab === "following" ? 1 : undefined,
      render: ([, b]) =>
        `${tabs(
          "Home timeline",
          all.map((t) => ({ ...t, on: t.tab === homeTab })),
        )}
        <div class="composer">${editor(state, "What's happening?")}${toolBar('<button data-testid="tweetButtonInline" disabled>Post</button>')}</div>
        <section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  if (url.pathname === "/i/bookmarks")
    return {
      title: "Bookmarks / X",
      requests: [
        r("Bookmarks", { count: 20, includePromotedContent: true }),
        // X lists folders above the posts only for an account its claims give them (Premium).
        ...(state.premium ? [r("BookmarkFoldersSlice", {})] : []),
      ],
      render: ([b, f]) => {
        const list = postsOf(b ?? null, state);
        const folders =
          f?.bookmarkFolders?.kind === "list"
            ? f.bookmarkFolders.folders
                .map((x) => `<a href="/i/bookmarks/${x.folderId}">${esc(x.name)} ›</a>`)
                .join("")
            : "";
        return `${header("All Bookmarks")}<input aria-label="Search Bookmarks" placeholder="Search Bookmarks"><nav aria-label="Bookmark folders">${folders}</nav><section data-list>${
          list === ""
            ? `<div class="empty"><h3>Bookmark posts to save them for later</h3><button>New folder</button></div>`
            : list
        }</section>`;
      },
    };
  // X's bookmark folders (bundle.BookmarkFolders): a folder's posts, and X's dialogs on their own
  // routes, X's words on each. X sends an account without folders, or a folder gone, to Bookmarks.
  if (lower === "i" && second === "bookmarks" && third !== undefined) {
    const away: Route = {
      title: "Bookmarks / X",
      requests: [],
      redirect: "/i/bookmarks",
      render: () => "",
    };
    if (!state.premium) return away;
    if (third === "create_folder")
      return {
        title: "Create Folder / X",
        requests: [],
        render: () =>
          routeDialog(
            "Create Folder",
            `<input aria-label="Name" name="name" maxlength="25"><button data-folder="create">Create</button>`,
          ),
      };
    if (third === "add") {
      // X carries the post in its router's state; the mock, in the query.
      const tweetId = q.get("tweet_id") ?? "";
      return {
        title: "Add to Folder / X",
        requests: [r("BookmarkFoldersSlice", { tweet_id: tweetId })],
        render: () =>
          routeDialog(
            "Add to Folder",
            `<a href="/i/bookmarks/create_folder">Create a new Bookmark Folder</a><div>All Bookmarks ✓</div>${state
              .folders()
              .map((f) => {
                const has = state.folderPosts(f.folderId).includes(tweetId);
                return `<div role="button" tabindex="0" data-folder="${has ? "pull" : "put"}:${f.folderId}:${esc(tweetId)}" data-folder-name="${esc(f.name)}">${esc(f.name)}${has ? " ✓" : ""}</div>`;
              })
              .join("")}`,
          ),
      };
    }
    const folder = state.folders().find((f) => f.folderId === third);
    if (folder === undefined) return away;
    if (fourth === "edit")
      return {
        title: "Edit Folder / X",
        requests: [],
        render: () =>
          routeDialog(
            "Edit Folder",
            `<input aria-label="Name" name="name" maxlength="25" value="${esc(folder.name)}"><button data-folder="save:${folder.folderId}">Save</button><div role="button" tabindex="0" data-folder="delete:${folder.folderId}"><span>Delete Folder</span></div>`,
          ),
      };
    return {
      title: "Bookmarks / X",
      requests: [
        r("BookmarkFolderTimeline", {
          bookmark_collection_id: folder.folderId,
          includePromotedContent: true,
        }),
      ],
      // A post's share menu here knows its folder, as X's does: it offers Remove from Folder.
      render: ([b]) =>
        `${header(folder.name)}<section data-list>${postsOf(b ?? null, state).replace(
          /data-menu="share:(\d+)"/g,
          `data-menu="share:$1:${folder.folderId}"`,
        )}</section>`,
    };
  }
  if (lower === "notifications") {
    const mentions = second === "mentions";
    return {
      title: "Notifications / X",
      requests: [
        r("NotificationsTimeline", { timeline_type: mentions ? "Mentions" : "All", count: 20 }),
      ],
      render: ([b]) => {
        const rows = (b?.notifications ?? []).map((n) => notificationRow(n, state)).join("");
        return `${header("Notifications", false)}${tabs("Notifications", [
          { label: "All", href: "/notifications", on: !mentions },
          { label: "Mentions", href: "/notifications/mentions", on: mentions },
          // oxlint-disable-next-line xtend/no-em-dash-copy -- X's own empty-state wording, as Mobbin recorded it
        ])}<section data-list>${rows === "" ? `<div class="empty"><h3>Nothing to see here — yet</h3></div>` : rows}</section>`;
      },
    };
  }
  if (lower === "explore") {
    const tabId = second === "tabs" ? (third ?? "for_you") : "for_you";
    const tab = state.exploreTabs.find((t) => t.id === tabId) ?? state.exploreTabs[0]!;
    return {
      title: "Explore / X",
      requests: [
        tab.id === "for_you"
          ? r("ExplorePage", { cursor: "" })
          : r("GenericTimelineById", { timelineId: tab.timelineId, count: 20 }),
      ],
      paged: tab.id === "for_you" ? 0 : undefined,
      render: ([b]) =>
        `<div class="bar"><input aria-label="Search query" placeholder="Search"><a href="/settings/explore" aria-label="Settings">⚙</a></div>${tabs(
          "Explore",
          state.exploreTabs.map((t) => ({
            label: t.label,
            href: t.id === "for_you" ? "/explore" : `/explore/tabs/${t.id}`,
            on: t.id === tab.id,
          })),
        )}${tab.id === "trending" ? `<div class="banner">Global Trending</div>` : ""}<section data-list>${(
          b?.trends ?? []
        )
          .map((t, i) => `<div data-trend-slot style="height:120px">${trendRow(t, i)}</div>`)
          .join("")}${postsOf(b ?? null, state)}</section>`,
    };
  }
  if (lower === "search") {
    const query = q.get("q") ?? "";
    const tab = SEARCH_TABS.find((t) => t.f === (q.get("f") ?? null)) ?? SEARCH_TABS[0];
    return {
      title: `${query} - Search / X`,
      requests: [
        r("SearchTimeline", {
          rawQuery: query,
          count: 20,
          querySource: q.get("src") ?? "typed_query",
          product: tab.product,
        }),
      ],
      render: ([b]) =>
        `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><input data-testid="SearchBox_Search_Input" aria-label="Search query" value="${esc(query)}"><button aria-label="More" aria-haspopup="menu" aria-expanded="false" data-menu="search">…</button></div>${tabs(
          "Search",
          SEARCH_TABS.map((t) => ({
            label: t.label,
            href: `/search?q=${encodeURIComponent(query)}&src=typed_query${t.f === null ? "" : `&f=${t.f}`}`,
            on: t.product === tab.product,
          })),
        )}<section data-list>${tab.product === "People" ? peopleOf(b ?? null) : postsOf(b ?? null, state)}</section>`,
    };
  }
  if (lower === "i" && second === "connect_people") {
    const creators = q.get("is_creator_only") === "true";
    return {
      title: "Follow / X",
      requests: [
        r("ConnectTabTimeline", {
          count: 20,
          context: creators ? JSON.stringify({ isCreatorOnlyConnectTab: true }) : "{}",
        }),
      ],
      render: ([b]) =>
        `${header("Follow")}${tabs("Follow", [
          { label: "Who to follow", href: "/i/connect_people", on: !creators },
          {
            label: "Creators for you",
            href: "/i/connect_people?is_creator_only=true",
            on: creators,
          },
        ])}${creators ? "" : "<h3>Suggested for you</h3>"}<section data-list>${peopleOf(b ?? null, creators ? "subscribe" : "follow", ROWS_NEAR_SCROLL)}</section>`,
    };
  }
  // X's List dialogs on their own routes (bundle.UserLists), X's words on each: Create a new List,
  // then Add to your List; Edit List with Manage members and Delete List. Each sends X's call.
  if (lower === "i" && second === "lists" && third === "create")
    return {
      title: "Create a new List / X",
      requests: [],
      render: () =>
        routeDialog(
          "Create a new List",
          `<input aria-label="Name" name="name" maxlength="25"><textarea aria-label="Description" name="description" maxlength="100"></textarea><label><input type="checkbox" name="isPrivate"> Make private</label><div class="muted">When you make a List private, only you can see it.</div><button data-list-form="create">Next</button>`,
        ),
    };
  if (lower === "i" && second === "lists" && third !== undefined && parts[4] === "suggested")
    return {
      title: "Add to your List / X",
      requests: [],
      render: () =>
        routeDialog(
          "Add to your List",
          `<input aria-label="Search people" placeholder="Search people"><button data-list-form="done:${esc(third)}">Done</button>`,
        ),
    };
  if (lower === "i" && second === "lists" && third !== undefined && fourth === "info") {
    const l = state.lists().find((x) => x.listId === third);
    if (l === undefined)
      return {
        title: "Lists / X",
        requests: [],
        redirect: `/${state.viewer.handle}/lists`,
        render: () => "",
      };
    return {
      title: "Edit List / X",
      requests: [r("ListByRestId", { listId: third })],
      render: () =>
        routeDialog(
          "Edit List",
          `<input aria-label="Name" name="name" maxlength="25" value="${esc(l.name)}"><textarea aria-label="Description" name="description" maxlength="100">${esc(l.description)}</textarea><label><input type="checkbox" name="isPrivate"${l.isPrivate ? " checked" : ""}> Make private</label><button data-list-form="save:${l.listId}">Done</button><a href="/i/lists/${l.listId}/members">Manage members</a><div role="button" tabindex="0" data-list-form="delete:${l.listId}"><span>Delete List</span></div>`,
        ),
    };
  }
  if (lower === "i" && second === "lists" && third !== undefined) {
    const of =
      fourth === "members" ? "ListMembers" : fourth === "followers" ? "ListSubscribers" : null;
    if (of !== null)
      return {
        title: `${fourth === "members" ? "Members" : "Followers"} / X`,
        requests: [r(of, { listId: third, count: 20 })],
        render: ([b]) =>
          `${header(fourth === "members" ? "List members" : "List followers")}${tabs(
            "List people",
            [
              { label: "Members", href: `/i/lists/${third}/members`, on: fourth === "members" },
              {
                label: "Followers",
                href: `/i/lists/${third}/followers`,
                on: fourth === "followers",
              },
            ],
          )}<section data-list>${peopleOf(b ?? null)}</section>`,
      };
    return {
      title: "List / X",
      requests: [
        r("ListByRestId", { listId: third }),
        r("ListLatestTweetsTimeline", { listId: third, count: 20 }),
      ],
      render: ([head, b]) => {
        const l = head?.lists[0];
        return `${header(l?.name ?? "List")}${
          l === undefined
            ? `<div class="empty"><h3>This List doesn't exist</h3></div>`
            : `<div data-testid="listHeader"><img alt="" src="${esc(l.bannerUrl ?? "")}" class="banner-img"><h2>${esc(l.name)}</h2><div>${esc(l.description)}</div>${l.owner === null ? "" : `<div><a href="/${esc(l.owner.handle)}">${esc(l.owner.name)}</a> @${esc(l.owner.handle)}</div>`}<div><a href="/i/lists/${l.listId}/members"><b>${compact(l.members)}</b> Members</a> <a href="/i/lists/${l.listId}/followers"><b>${compact(l.followers)}</b> Followers</a></div>${
                // X's owner gets Edit List, a link; everyone else X's Follow, with no test id.
                l.owner?.userId === state.viewer.userId
                  ? `<a href="/i/lists/${l.listId}/info" role="link">Edit List</a>`
                  : `<button data-list-follow="${l.listId}">${l.following === true ? "Following" : "Follow"}</button>`
              }</div>`
        }<section data-list>${postsOf(b ?? null, state)}</section>`;
      },
    };
  }
  if (lower === "i" && second === "account_analytics") {
    const page = third ?? "overview";
    const labels = ANALYTICS_RANGES[page];
    const nav = tabs(
      "Analytics",
      ANALYTICS_TABS.map(([id, label]) => ({
        label,
        href: `/i/account_analytics/${id}`,
        on: id === page,
      })),
    );
    // Without Premium, X's upsell over the page, as live X showed it (2026-11-03), and no queries.
    if (!state.premium || labels === undefined)
      return {
        title: "Analytics / X",
        requests: [],
        render: () =>
          state.premium
            ? `${header("Analytics")}${nav}`
            : `${header("Analytics")}<div role="dialog" data-testid="analytics-paywall"><h2>Advanced analytics with Plus</h2><p>See your profile analytics, understand your audience and more. Upgrade to continue.</p><a href="/i/premium_sign_up">Upgrade</a><button type="button">Maybe later</button></div>`,
      };
    const range = labels.includes(homeTab) ? homeTab : "7D";
    const days = ANALYTICS_DAYS[range]!;
    // X's analytics end with today, here the made-up overview's last day; ranges start at midnight.
    const week = state.fixture("accountOverviewDailyQuery", "overview:7")!.accountAnalytics!;
    const end = Date.parse(week.kind === "overview" ? week.from : "") + 7 * DAY_MS;
    const from = end - days * DAY_MS;
    const iso = (ms: number) => new Date(ms).toISOString();
    const buttons = `<div class="ranges">${labels
      .map(
        (l) =>
          `<button type="button" data-range="${l}" class="${l === range ? "bg-btn-primary" : "border-normal"}">${l}</button>`,
      )
      .join("")}</div>`;
    const tile = (label: string, value: string) =>
      `<div data-testid="analytics-tile"><span>${esc(label)}</span> <span>${esc(value)}</span></div>`;
    const top = (title: string) => `${header("Analytics")}${nav}<h2>${title}</h2>${buttons}`;
    if (page === "overview")
      return {
        title: "Analytics / X",
        requests: [
          r("accountOverviewDailyQuery", {
            current_from: from,
            current_from_iso: iso(from),
            current_to: end,
            current_to_iso: iso(end),
            prev_from: from - days * DAY_MS,
            prev_from_iso: iso(from - days * DAY_MS),
            prev_to: from,
            prev_to_iso: iso(from),
            backfill_from: end - 2 * DAY_MS,
            backfill_to: end,
            show_realtime_active_followers: false,
            show_verified_followers: true,
          }),
        ],
        render: ([b]) => {
          const a = b?.accountAnalytics;
          if (a?.kind !== "overview") return top("Account overview");
          const total = (m: string) => a.daily.reduce((n, d) => n + (d[m] ?? 0), 0);
          const engagements = ANALYTICS_ENGAGING.reduce((n, m) => n + total(m), 0);
          return `${top("Account overview")}<div class="tiles">${[
            tile("Impressions", total("Impressions").toLocaleString("en")),
            tile("Engagements", engagements.toLocaleString("en")),
            tile("Likes", total("Likes").toLocaleString("en")),
            tile("Reposts", total("Retweets").toLocaleString("en")),
          ].join("")}</div>`;
        },
      };
    if (page === "content")
      return {
        title: "Analytics / X",
        requests: [
          r("contentPageQuery", {
            from_time: iso(from),
            to_time: iso(end - 1),
            max_results: 1000,
            query_page_size: 100,
            requested_metrics: ["Impressions", "Likes", "Engagements", "Replies", "Retweets"],
          }),
        ],
        render: ([b]) => {
          const a = b?.accountAnalytics;
          return `${top("Content")}<table><tr><th>Date</th><th>Impressions</th><th>Likes</th></tr>${(a?.kind ===
          "content"
            ? a.posts
            : []
          )
            .map(
              (p) =>
                `<tr data-testid="analytics-post"><td><a href="/you/status/${p.postId}">${esc(p.text)}</a></td><td>${p.metrics.Impressions ?? 0}</td><td>${p.metrics.Likes ?? 0}</td></tr>`,
            )
            .join("")}</table>`;
        },
      };
    if (page === "video")
      return {
        title: "Analytics / X",
        requests: [
          r("mediaMetricsQuery", {
            from_timestamp: end - 2 * days * DAY_MS,
            to_timestamp: end - 1,
            to_timestamp_revenue: end,
            metric_types: [
              "Playback25",
              "Playback50",
              "Playback75",
              "PlaybackComplete",
              "PlaybackStart",
              "VideoView",
              "WatchTime",
            ],
            estimated_revenue_enabled: false,
          }),
          r("videoListProviderQuery", { cursor: null, limit: 30, estimatedRevenueEnabled: false }),
        ],
        render: ([b]) => {
          const a = b?.accountAnalytics;
          return `${top("Video overview")}${tile("Views", String(a?.kind === "video" ? (a.totals.VideoView ?? 0) : 0))}`;
        },
      };
    return {
      title: "Analytics / X",
      requests: [
        r("audienceOverviewDataQuery", {
          dimensions: ["Age", "Gender", "EngagementType", "ClientAppId"],
          from_time_incl: from,
          to_time_excl: end - 1,
          heatmap_from_time_incl: iso(end - 28 * DAY_MS),
          heatmap_to_time_excl: iso(end - 1),
          requested_metrics: ["Likes"],
        }),
      ],
      render: () => `${top("Audience")}<section>Gender</section><section>Age</section>`,
    };
  }
  if (url.pathname === "/i/jf/creators/inspiration/top_posts") {
    // X's Creator Studio page: its filters are plain buttons that switch the list in place.
    const [engagement = "Likes", period = "Daily"] = homeTab.split(":");
    const button = (filter: string, id: string, label: string, on: boolean) =>
      `<button type="button" class="jf-element" data-jf="${filter}:${id}"${on ? ' style="font-weight:700"' : ""}>${esc(label)}</button>`;
    return {
      title: "Inspiration / X",
      requests: [
        r("GenericTimelineById", {
          timelineId: inspirationTimelineId(engagement, period),
          count: 20,
          withQuickPromoteEligibilityTweetFields: true,
        }),
      ],
      render: ([b]) =>
        `${header("Inspiration")}<div class="jf-element">${button("language", "en", "💬 EN", true)}${INSPIRATION_FILTERS.period
          .map((f) => button("period", f.id, f.label, f.id === period))
          .join("")}${INSPIRATION_FILTERS.engagement
          .map((f) => button("engagement", f.id, f.label, f.id === engagement))
          .join("")}</div><section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  const searchTab = COMMUNITIES_SEARCH_TABS.find((t) => t.page === third);
  if (
    lower === "i" &&
    second === "communities" &&
    searchTab !== undefined &&
    fourth === undefined
  ) {
    const query = q.get("q") ?? "";
    const none = `<div class="empty"><h3>No results for "${esc(query)}"</h3><div>The term you entered did not bring up any results. Try a different search term.</div></div>`;
    return {
      title: "Search Communities / X",
      requests:
        query === ""
          ? []
          : [
              searchTab.op === "CommunitiesSearchQuery"
                ? r(searchTab.op, { query, cursor: null })
                : r(searchTab.op, { rawQuery: query, count: 20 }),
            ],
      render: ([b]) =>
        `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><form role="search"><input aria-label="Search Communities" placeholder="Search for Communities and Posts" value="${esc(query)}"></form></div>${
          query === ""
            ? `<div class="empty"><h3>Search results will appear here</h3></div>`
            : `${tabs(
                "Search Communities",
                COMMUNITIES_SEARCH_TABS.map((t) => ({
                  label: t.label,
                  href: `/i/communities/${t.page}?q=${encodeURIComponent(query)}`,
                  on: t === searchTab,
                })),
              )}<section data-list>${
                searchTab.op !== "CommunitiesSearchQuery"
                  ? postsOf(b ?? null, state) || none
                  : (b?.communities ?? [])
                      .map(
                        (c) =>
                          `<a href="/i/communities/${c.communityId}" data-testid="communityCell"><img alt="" src="${esc(c.bannerUrl ?? "")}" class="avatar"><span>${esc(c.name)}</span> <span class="muted">${compact(c.members)} Members · ${esc(c.topic ?? "")}</span></a>`,
                      )
                      .join("") || none
              }</section>`
        }`,
    };
  }
  // X's Create a new Community (bundle.Communities), on its own route: name, purpose, then
  // Membership, and the approval question for a Restricted one. Create opens the new Community.
  if (lower === "i" && second === "communities" && third === "create" && fourth === undefined)
    return {
      title: "Create a new Community / X",
      requests: [],
      render: () =>
        routeDialog(
          "Create a new Community",
          `<div data-x-form><div class="muted">Tell us a little about your Community. You can always change these details later.</div><input aria-label="Community name" name="name" maxlength="30"><textarea aria-label="Community purpose" name="description" maxlength="160"></textarea><h3>Membership</h3><label><input type="radio" name="joinPolicy" value="Open" checked> Open</label><div class="muted">Anyone can join and/or be invited to the Community.</div><label><input type="radio" name="joinPolicy" value="Restricted"> Restricted</label><div class="muted">People must ask to join, and the mod team must approve those requests. People invited by the mod team are automatically approved.</div><h3>Approval question (optional)</h3><input aria-label="Approval question (optional)" name="question"><button data-x-save="CreateCommunity">Create</button></div>`,
          state.compact,
        ),
    };
  // X's Premium upsell, where X's create button goes for an account X has not verified.
  if (lower === "i" && second === "verified-get-verified")
    return {
      title: "Premium / X",
      requests: [],
      render: () =>
        `${header("Premium")}<div class="empty"><h3>Get verified</h3><div>Subscribe to Premium to create a Community.</div><a href="/i/premium_sign_up">Subscribe</a></div>`,
    };
  // X's Admin tools (bundle.Communities), for a Community's admins and moderators only; X sends
  // anyone else Home, and General settings is its admins' alone. Each tool is its own page.
  if (
    lower === "i" &&
    second === "communities" &&
    third !== undefined &&
    (fourth === "tools" || fourth === "moderation")
  ) {
    const id = third;
    const c = state.community(id);
    const admin = state.communityAdmin(id);
    const rest = parts.slice(4).join("/");
    const base = `/i/communities/${id}`;
    // Its queues draw X's not-found page for anyone else instead.
    if (fourth === "moderation" && c !== undefined && admin === undefined)
      return {
        title: "Page not found / X",
        requests: [r("CommunitiesFetchOneQuery", { communityId: id })],
        render: () =>
          `${header("Page not found")}<div class="empty"><h3>Hmm...this page doesn’t exist. Try searching for something else.</h3></div>`,
      };
    if (
      c === undefined ||
      admin === undefined ||
      (rest.startsWith("settings") && c.role !== "Admin")
    )
      return { title: "Home / X", requests: [], redirect: "/home", render: () => "" };
    const fetchOne = r("CommunitiesFetchOneQuery", { communityId: id });
    const link = (label: string, href: string, description = "") =>
      `<a href="${esc(href)}" role="link"><span>${esc(label)}</span>${description === "" ? "" : `<span class="muted"> ${esc(description)}</span>`}</a>`;
    if (fourth === "tools" && rest === "")
      return {
        title: "Admin tools / X",
        requests: [fetchOne, r("CommunityToolsScreenContainerQuery", { communityId: id })],
        render: () =>
          `${header(c.role === "Admin" ? "Admin tools" : "Moderator tools")}<h3>Review needed</h3>${link("Reported posts", `${base}/moderation/reported_tweets`)}${admin.requests === null ? "" : link("Member requests", `${base}/moderation/member_requests`)}${link("Moderation log", `${base}/moderation/moderation_log`)}<h3>Community management</h3>${c.role === "Admin" ? link("General settings", `${base}/tools/settings`, "Edit Community name, purpose, and more") : ""}${link("Members", `${base}/tools/members`)}${link("Rules", `${base}/tools/rules`)}${
            c.role === "Moderator"
              ? `<div role="button" tabindex="0" data-x-confirm="leave"><span>Leave moderation team</span></div>`
              : ""
          }`,
      };
    const settings = `${base}/tools/settings`;
    if (rest === "settings")
      return {
        title: "Settings / X",
        requests: [fetchOne],
        render: () =>
          `${header("Settings")}<h3>Community information</h3>${link("Name", `${settings}/name`, c.name)}${link("Purpose", `${settings}/purpose`, c.description ?? "")}${link("Approval question", `${settings}/question`, admin.question ?? "")}${link("Topic", `${settings}/topic`, c.topic ?? "")}${link("Search tags", `${settings}/searchtags`, (admin.searchTags ?? []).join(", "))}${link("Pinned hashtags", `${settings}/hashtags`)}<h3>Membership</h3>${link("Membership type", `${settings}/membership`, c.joinPolicy === "Open" ? "Open" : "Restricted")}<label><span>Adult Content (NSFW)</span><input type="checkbox" name="adultContentSetting" data-x-check="SettingsUpdateAdultContentMutation"${admin.nsfw === true ? " checked" : ""}></label><div class="muted">You must enable this setting if your community contains adult-sensitive content.</div>${
            admin.deletable === true
              ? `<div role="button" tabindex="0" data-x-confirm="delete"><span>Delete Community</span></div>`
              : ""
          }`,
      };
    // X's edit for each setting; Save sends X's call and goes back to Settings.
    const edits: Readonly<Record<string, readonly [string, string, string, string]>> = {
      "settings/name": ["Edit name", "CommunityEditName", "name", c.name],
      "settings/purpose": [
        "Edit purpose",
        "CommunityEditPurpose",
        "description",
        c.description ?? "",
      ],
      "settings/question": [
        "Approval question",
        "CommunityEditQuestion",
        "question",
        admin.question ?? "",
      ],
    };
    const editing = edits[rest];
    if (editing !== undefined) {
      const [title, op, field, value] = editing;
      return {
        title: `${title} / X`,
        requests: [fetchOne],
        render: () =>
          `<div data-x-form>${header(title)}<input aria-label="${esc(title)}" name="${field}" value="${esc(value)}"><button data-x-save="${op}">Save</button></div>`,
      };
    }
    // X's queues: each row X's own buttons, and X's words in a decided row's place.
    // X's queues, each page of rows from X's answer, each row X's own buttons; a decided row
    // is X's words in its place, drawn by the page script.
    const requestRows = (b: EngineBatch | null | undefined) =>
      (b?.joinRequests?.requests ?? [])
        .map((q) => {
          const u = state.user(q.userId)!;
          return `<div data-testid="UserCell"><a href="/${esc(u.handle)}"><b>${esc(u.name)}</b></a> <a href="/${esc(u.handle)}">@${esc(u.handle)}</a><div>${esc(u.bio)}</div><div>${esc(q.answer ?? "")}</div><button data-x-request="approve:${q.userId}">Approve</button><button data-x-request="deny:${q.userId}">Deny</button></div>`;
        })
        .join("");
    const caseRows = (b: EngineBatch | null | undefined) =>
      (b?.reportCases?.cases ?? [])
        .map((k) => {
          const p = state.post(k.postId)!;
          return `<div data-case="${k.postId}"><div>Reported by ${k.reports} members</div>${article(p, state)}<button data-x-case="keep:${k.postId}">Keep</button><a href="/i/report/hidetweet/${k.postId}">Hide</a><a href="/i/report/removecommunitymember/${p.author.userId}?community_id=${id}&post=${k.postId}">Ban</a></div>`;
        })
        .join("");
    if (rest === "member_requests")
      return {
        title: "Member requests / X",
        requests: [fetchOne, r("MemberRequests_Query", { communityId: id })],
        paged: 1,
        more: requestRows,
        render: ([, b]) =>
          `${header("Member requests")}<section data-list>${requestRows(b)}</section>`,
      };
    if (rest === "reported_tweets")
      return {
        title: "Reported posts / X",
        requests: [
          fetchOne,
          r("CommunityModerationTweetCasesSlice", { communityId: id, count: 20 }),
        ],
        paged: 1,
        more: caseRows,
        render: ([, b]) => `${header("Reported posts")}<section data-list>${caseRows(b)}</section>`,
      };
    // The tools Xtend leaves on X's own page: here, each its title and X's back.
    const titles: Readonly<Record<string, string>> = {
      "settings/topic": "Edit topic",
      "settings/searchtags": "Edit search tags",
      "settings/hashtags": "Pinned hashtags",
      "settings/membership": "Membership",
      spam_settings: "Spam settings",
      members: "Members",
      moderators: "Members",
      rules: "Rules",
      analytics: "Community Analytics",
      lists: "Community list",
      reported_tweets: "Reported posts",
      member_requests: "Member requests",
      moderation_log: "Moderation log",
    };
    const title = titles[rest];
    if (title !== undefined)
      return {
        title: `${title} / X`,
        requests: [fetchOne],
        render: () => `${header(title)}<div class="empty"><h3>${esc(title)}</h3></div>`,
      };
  }
  // X's Invite members, a checklist step: X's own page.
  if (lower === "i" && second === "communities" && third !== undefined && fourth === "invite")
    return {
      title: "Invite members / X",
      requests: [],
      render: () =>
        `${header("Invite members")}<input aria-label="Search for people to invite" placeholder="Search for people to invite">`,
    };
  if (lower === "i" && second === "communities" && third !== undefined && fourth === "search") {
    const id = third;
    const query = q.get("q") ?? "";
    // Top and Latest switch in place on this one URL, each its own ranking mode.
    const mode = homeTab === "Recency" ? "Recency" : "Likes";
    return {
      title: "Search Community / X",
      requests: [
        r("CommunityQuery", { communityId: id }),
        ...(query === ""
          ? []
          : [
              r("CommunityTweetSearchModuleQuery", {
                count: 20,
                query,
                communityId: id,
                timelineRankingMode: mode,
              }),
            ]),
      ],
      render: ([head, b]) =>
        `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><form role="search"><input aria-label="Search Community" placeholder="Search ${esc(head?.communities[0]?.name ?? "")}" value="${esc(query)}"></form></div>${
          query === ""
            ? ""
            : tabs("Search Community", [
                { label: "Top", tab: "Likes", on: mode === "Likes" },
                { label: "Latest", tab: "Recency", on: mode === "Recency" },
              ])
        }<section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  if (lower === "i" && second === "communities" && third !== undefined) {
    const id = third;
    // X opens on Latest for a member and Top otherwise, then on the tab last picked there
    // (bundle.Communities).
    const role = state.community(id)?.role;
    const member = role === "Member" || role === "Moderator" || role === "Admin";
    const tab =
      fourth === undefined
        ? (COMMUNITY_TABS.find((t) => t.path === "" && t.label === homeTab) ??
          COMMUNITY_TABS[member ? 1 : 0])
        : COMMUNITY_TABS.find((t) => t.path === `/${fourth}`);
    const timeline =
      tab === undefined
        ? null
        : tab.label === "Media"
          ? r("CommunityMediaTimeline", { communityId: id, count: 20, withCommunity: true })
          : tab.label === "About"
            ? r("CommunityAboutTimeline", { communityId: id })
            : r("CommunityTweetsTimeline", {
                communityId: id,
                count: 20,
                displayLocation: "Community",
                rankingMode: tab.label === "Latest" ? "Recency" : "Relevance",
                withCommunity: true,
              });
    return {
      title: "Community / X",
      requests: [
        r("CommunityQuery", { communityId: id }),
        ...(timeline === null ? [] : [timeline]),
      ],
      paged: tab?.label === "Top" || tab?.label === "Latest" ? 1 : undefined,
      render: ([head, b]) => {
        const c = head?.communities[0];
        if (c === undefined || tab === undefined)
          return `${header("Community")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`;
        const about = `<div data-testid="communityAbout"><h3>Community Info</h3><div>${esc(c.description ?? "")}</div><h3>Rules</h3><ol>${(
          c.rules ?? []
        )
          .map(
            (rule) => `<li>${esc(rule.name)}<div class="muted">${esc(rule.description)}</div></li>`,
          )
          .join("")}</ol>${(b?.sections ?? [])
          .map(
            (s) =>
              `<h3>${esc(s.title)}</h3>${s.userIds
                .flatMap((u) => b!.users.find((x) => x.userId === u) ?? [])
                .map((u) => userCell(u))
                .join(
                  "",
                )}${s.link === null ? "" : `<a href="${esc(new URL(s.link).pathname)}">Show more</a>`}`,
          )
          .join("")}</div>`;
        // X's top bar: the Community's name, its search and its "More"; the header's own buttons
        // after the member count.
        const pin = state.communityPinned(id)
          ? "Unpin Community from Home screen"
          : "Pin Community";
        // X's gear to Admin tools for its admins and moderators, where others get "More".
        const more =
          c.role === "Admin" || c.role === "Moderator"
            ? `<a href="/i/communities/${id}/tools" aria-label="${c.role === "Admin" ? "Admin tools" : "Moderator tools"}">⚙</a>`
            : `<button aria-label="More">…</button>`;
        // X's checklist for a Community the user made here, atop its posts on its own page only.
        const done = state.checklist(id);
        const steps = [
          ["setup_clicked_rules", "Review your rules", `/i/communities/${id}/tools/rules`],
          [
            "setup_clicked_personalization",
            "Personalize your Community",
            `/i/communities/${id}/tools/settings`,
          ],
          ["setup_clicked_invite", "Invite members", `/i/communities/${id}/invite`],
          ["setup_clicked_tweet", "Post your Community", "/compose/post"],
        ] as const;
        const checklist =
          done === null || tab.path !== ""
            ? ""
            : `<div data-testid="communityChecklist"><h3>Community checklist</h3><button aria-label="Dismiss Checklist" data-x-step="dismiss">✕</button><div class="muted">Just a few things to get your Community in good shape for its debut ...</div><div role="list">${steps
                .map(
                  ([flag, title, to]) =>
                    `<div role="listitem" data-x-step="${flag}:${to}"><b>${esc(title)}</b><svg aria-label="${done.has(flag) ? "Completed" : "Uncompleted"}" viewBox="0 0 1 1"></svg></div>`,
                )
                .join("")}</div></div>`;
        // X's summary over a Community it just made.
        const summary = q.has("show_creation_summary")
          ? `<div ${state.compact ? 'class="route"' : 'role="dialog" aria-modal="true" class="dialog"'} data-x-summary><h2>About your new Community</h2><p>We start you out with some basic settings, but your Community is completely customizable. We’ll get into that next.</p><h3>Your Community is ${c.joinPolicy === "Open" ? "Open" : "Restricted"}</h3><h3>Your starter Community rules are</h3><ul>${(c.rules ?? []).map((rule) => `<li>${esc(rule.name)}</li>`).join("")}</ul><h3>Settings can be changed in Admin Tools</h3><p>Not feeling your settings? No problem. It’s easy enough to change.</p><button data-x-got-it>Got it</button></div>`
          : "";
        return `${summary}<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><h2 role="heading">${esc(c.name)}</h2><a href="/i/communities/${id}/search" aria-label="Search Community">⌕</a>${more}</div><div data-testid="communityHeader"><img alt="" src="${esc(c.bannerUrl ?? "")}" class="banner-img"><h2>${esc(c.name)}</h2><a href="/i/communities/${c.communityId}/members"><b>${compact(c.members)}</b> Members</a><button aria-label="${pin}" data-community-pin="${id}">📌</button><button aria-label="Share Community">⤴</button>${joinButton(c, state.communityRequested(id))}</div>${tabs(
          "Community",
          COMMUNITY_TABS.map((t) =>
            t.path === "" && tab.path === ""
              ? { label: t.label, tab: t.label, on: t === tab }
              : { label: t.label, href: `/i/communities/${id}${t.path}`, on: t === tab },
          ),
        )}${checklist}<section data-list>${
          tab.label === "About"
            ? about
            : // X gives a Community's moderators their own rows on its posts' "...".
              c.role === "Moderator" || c.role === "Admin"
              ? postsOf(b ?? null, state).replace(
                  /data-menu="post:(\d+)"/g,
                  `data-menu="post:$1:community:${id}"`,
                )
              : postsOf(b ?? null, state)
        }</section>`;
      },
    };
  }
  // X's Ban (bundle.Report's removecommunitymember flow): the moderator picks the rule the author
  // broke, and X removes them and goes back. Synthetic: `post`, the mock's note of the post banned
  // from, which X's flow takes from its referrer.
  if (
    lower === "i" &&
    second === "report" &&
    third === "removecommunitymember" &&
    fourth !== undefined
  )
    return {
      title: "Ban / X",
      requests: [],
      render: () =>
        routeDialog(
          "Ban from Community",
          ["Keep posts on topic.", "No spam"]
            .map(
              (rule) =>
                `<div role="button" tabindex="0" data-ban-rule="${esc(rule)}" data-post="${esc(q.get("post") ?? "")}">${esc(rule)}</div>`,
            )
            .join(""),
          state.compact,
        ),
    };
  // X's Hide post (bundle.Report's hidetweet flow): the moderator picks the rule it broke, and X
  // hides the post and goes back to where it was. It sends no GraphQL call.
  if (lower === "i" && second === "report" && third === "hidetweet" && fourth !== undefined) {
    const p = state.post(fourth);
    return {
      title: "Hide post / X",
      requests: [],
      render: () =>
        routeDialog(
          "Hide post",
          `<h3>Help @${esc(p?.author.handle ?? "")} understand what went wrong</h3><div class="muted">We’ll share this feedback, but not who it came from.</div>${[
            "Keep posts on topic.",
            "Be kind and respectful.",
          ]
            .map(
              (rule) =>
                `<div role="button" tabindex="0" data-hide-rule="${esc(rule)}">${esc(rule)}</div>`,
            )
            .join("")}`,
          state.compact,
        ),
    };
  }
  // X's news story: its summary, then the posts of the tab `?timeline=` names (the first, without).
  if (lower === "i" && second === "trending" && third !== undefined && fourth === undefined) {
    const story = state.batchFor("AiTrendByRestId", { trendId: third })?.story;
    const timelineId = q.get("timeline") ?? story?.timelines[0]?.timelineId;
    return {
      title: "News / X",
      requests: [
        r("AiTrendByRestId", { trendId: third, includePromotedContent: false }),
        ...(timelineId === undefined ? [] : [r("GenericTimelineById", { timelineId, count: 20 })]),
      ],
      render: ([head, b]) =>
        head?.story === undefined
          ? `${header("News")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`
          : `${header("News")}<div data-testid="trendStory"><h2>${esc(head.story.title)}</h2><div>Last updated</div><p>${esc(head.story.summary)}</p></div>${tabs(
              "Story",
              head.story.timelines.map((t, i) => ({
                label: t.label,
                href: `/i/trending/${third}${i === 0 ? "" : `?timeline=${encodeURIComponent(t.timelineId)}`}`,
                on: t.timelineId === timelineId,
              })),
            )}<section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  // X's NBA league page: each tab its own page under /i/nba.
  if (lower === "i" && second === "nba" && third !== "game" && fourth === undefined) {
    const tab = third === "standings" || third === "players" ? third : "games";
    const day = Date.parse(state.batchFor("NBASchedule", {})?.games?.[0]?.startsAt ?? "") || 0;
    return {
      title: "NBA / X",
      requests: [
        r("NBATeams", {}),
        tab === "games"
          ? r("NBASchedule", {
              start_ms: String(day - 43_200_000),
              end_ms: String(day + 43_200_000),
              limit: 500,
            })
          : tab === "standings"
            ? r("NBAStandings", {})
            : r("NBALeaders", { limit: 25 }),
      ],
      render: ([, b]) =>
        `${header("NBA")}${tabs("NBA", [
          { label: "Schedule", href: "/i/nba/games", on: tab === "games" },
          { label: "Standings", href: "/i/nba/standings", on: tab === "standings" },
          { label: "Stats", href: "/i/nba/players", on: tab === "players" },
        ])}<section data-testid="nbaHub">${
          tab === "games"
            ? (b?.games ?? [])
                .map((g) => `<a href="/i/nba/game/${g.gameId}">${esc(gameState(g))}</a>`)
                .join("")
            : tab === "standings"
              ? (b?.standings ?? [])
                  .flatMap((c) => c.divisions.flatMap((d) => d.teams))
                  .map(
                    (t) =>
                      `<div data-testid="standing">${esc(t.abbreviation)} ${t.wins}-${t.losses}</div>`,
                  )
                  .join("")
              : (b?.leaders?.[0]?.leaders ?? [])
                  .map((l) => `<div data-testid="leader">${esc(l.name)} ${esc(l.value)}</div>`)
                  .join("")
        }</section>`,
    };
  }
  if (lower === "i" && second === "nba" && third === "game" && fourth !== undefined) {
    const id = fourth;
    const tab = GAME_TABS.find((t) => t === homeTab) ?? "Top";
    const posts =
      tab === "Top" || tab === "Latest"
        ? [
            r(tab === "Top" ? "SportsGameTopTimeline" : "SportsGameLatestTimeline", {
              gameId: id,
              count: 20,
            }),
          ]
        : [];
    const day = Date.parse(state.game(id)?.startsAt ?? "") || 0;
    return {
      title: "Game / X",
      requests: [
        r("NBATeams", {}),
        r("NBAGameHydrate", { rest_id: id }),
        r("NBASchedule", {
          start_ms: String(day - 43_200_000),
          end_ms: String(day + 43_200_000),
          limit: 500,
        }),
        r("NBALiveGame", { rest_id: id }),
        ...posts,
      ],
      render: ([, hydrate, schedule, , b]) => {
        const g = hydrate?.games?.[0];
        if (g === undefined)
          return `${header("Game")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`;
        // X's day pills are buttons named by both teams, not by the game: none says which is open.
        const strip = (schedule?.games ?? [])
          .map(
            (d) =>
              `<button data-testid="nflGameCarouselPill-${d.gameId}" aria-label="${esc(`${d.away.name ?? ""} @ ${d.home.name ?? ""}`)}" data-href="/i/nba/game/${d.gameId}">${esc(d.away.abbreviation ?? "")} ${esc(gameState(d))} ${esc(d.home.abbreviation ?? "")}</button>`,
          )
          .join(" ");
        const notes = (t: EngineGame["away"]) =>
          `<div class="muted">${t.timeouts === null ? "" : `${t.timeouts} of 7 timeouts remaining`}${t.bonus === true ? " Bonus" : ""}</div>`;
        // As X draws it live: its score hero names the teams, and nothing carries the game's id.
        const hero = `<div data-testid="nflGameScoreHero"><div data-testid="nflGameScoreHeroAwayTeam">${esc(g.away.name ?? "")}</div><div data-testid="nflGameScoreHeroScore">${g.away.points ?? ""} - ${g.home.points ?? ""}</div><div data-testid="nflGameScoreHeroHomeTeam">${esc(g.home.name ?? "")}</div><div data-testid="nflGameScoreHeroStatus">${esc(gameState(g))}</div></div>`;
        const gameTabs = `<nav role="tablist" aria-label="Game" class="tabs">${GAME_TABS.map(
          (t) =>
            `<div role="tab" data-testid="nflGameTab-${t.toLowerCase()}" data-home-tab="${t}" aria-selected="${t === tab}" tabindex="0"><span>${t}</span></div>`,
        ).join("")}</nav>`;
        return `${header("Game")}<div data-testid="nbaGameRoot"><div data-testid="scoreStrip">${strip}</div><div data-testid="nbaGameHeader">${hero}${notes(g.away)}${notes(g.home)}${
          g.lastPlay === null
            ? ""
            : `<div><b>${esc(g.lastPlay.kind)}</b> ${esc(g.lastPlay.description)}</div>`
        }</div>${gameTabs}<section data-list>${postsOf(b ?? null, state)}</section></div>`;
      },
    };
  }
  if (lower === "i" && second === "safety")
    return {
      title: "Report / X",
      requests: [],
      render: () =>
        routeDialog(
          "What are you reporting?",
          `<p>Select the issue. You can report the post or the account.</p><div role="radiogroup">${[
            "Hate",
            "Abuse & Harassment",
            "Violent Speech",
            "Child Safety",
            "Privacy",
            "Spam",
            "Suicide or self-harm",
            "Sensitive or disturbing media",
            "Impersonation",
            "Violent & hateful entities",
          ]
            .map((c) => `<label role="radio" aria-checked="false" tabindex="0">${esc(c)}</label>`)
            .join("")}</div><button disabled>Next</button>`,
        ),
    };
  if (lower === "messages")
    return second === "compose"
      ? {
          title: "Messages / X",
          requests: [],
          render: () =>
            routeDialog(
              "Send post",
              `<input aria-label="Search people" placeholder="Search people"><button disabled>Send</button>`,
            ),
        }
      : {
          title: "Chat / X",
          requests: [],
          render: () =>
            `${header("Chat", false)}<div class="empty"><h3>Welcome to your inbox!</h3></div>`,
        };
  // X's GIF search, opened by the composer's GIF button; typing searches in place. At the engine's
  // width X draws it in its compact layout, as the page itself with its only Back, not a dialog.
  if (lower === "i" && second === "foundmedia" && third === "search") {
    const query = q.get("q") ?? "";
    return {
      title: "Search for GIFs / X",
      requests: [r("GifSearch", { query })],
      paged: 0,
      render: ([b]) =>
        `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><input placeholder="Search for GIFs" value="${esc(query)}"></div><label>Auto-play GIFs <input type="checkbox" role="switch" checked></label><section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  // X's Edit profile (bundle.SettingsProfile) on its own route, X's words and field names on it.
  // A picture's button stands for picking a file; Save sends X's calls (client.ts).
  if (lower === "settings" && second === "profile") {
    const u = state.user(state.viewer.userId!)!;
    const field = (label: string, name: string, value: string) =>
      `<label>${label} <input name="${name}" value="${esc(value)}"></label>`;
    return {
      title: "Edit profile / X",
      requests: [],
      render: () =>
        routeDialog(
          "Edit profile",
          `<button data-testid="Profile_Save_Button">Save</button><button aria-label="Add banner photo" data-pick="banner">📷</button><button aria-label="Add avatar photo" data-pick="avatar">📷</button>${field("Name", "displayName", u.name)}<label>Bio <textarea name="description">${esc(u.bio)}</textarea></label>${field("Location", "location", u.location ?? "")}${field("Website", "url", u.website?.url ?? "")}`,
        ),
    };
  }
  if (lower === "compose")
    return {
      title: "Compose new post / X",
      requests: [],
      render: () =>
        routeDialog(
          "",
          `${editor(state, "What's happening?")}${toolBar('<button data-testid="tweetButton">Post</button>', true)}`,
        ),
    };

  if (first !== "" && !RESERVED.has(lower)) {
    const u = state.byHandle(first);
    // An X Article's reader: cover, title, the author with Follow, the post's buttons, the body.
    if (second === "article" && third !== undefined)
      return {
        title: "Article / X",
        requests: [
          r("TweetResultByRestId", {
            tweetId: third,
            includePromotedContent: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withCommunity: true,
          }),
        ],
        render: ([b]) => {
          const p = b?.posts[0];
          const body = b?.articles?.[0];
          if (p === undefined || body === undefined || p.card === null)
            return `${header("Article")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`;
          return `${header("Article")}${p.card.imageUrl === null ? "" : `<img alt="" src="${esc(p.card.imageUrl)}">`}<h1>${esc(p.card.title)}</h1><div data-testid="User-Name">${avatar(p.avatarUrl, p.author.handle)}<span>${esc(p.author.name)}</span> <span>@${esc(p.author.handle)}</span> · <time datetime="${p.createdAt}">${shortDate(p.createdAt)}</time></div>${u === undefined ? "" : followButton(u)}${actions(p)}<div class="article-body">${body.blocks
            .map((k) => `<p>${esc(k.text)}</p>`)
            .join("")}</div>`;
        },
      };
    if (second === "status" && third !== undefined) {
      const id = third;
      if (fourth === "analytics") {
        const p = state.post(id);
        const created = p === undefined ? Date.now() : Date.parse(p.createdAt);
        const organic = [
          "DetailExpands",
          "Engagements",
          "Follows",
          "Impressions",
          "LinkClicks",
          "ProfileVisits",
        ];
        return {
          title: "Post Analytics / X",
          requests: [
            r("TweetActivityQuery", {
              restId: id,
              from_time: new Date(created).toISOString(),
              to_time: new Date().toISOString(),
              first_48_hours_time: new Date(created + 48 * 3_600_000).toISOString(),
              requested_organic_metrics: organic,
              requested_promoted_metrics: [...organic, "CostPerFollower"],
            }),
          ],
          // X's labels in X's order; it counts Follows but does not draw them.
          render: ([b]) =>
            `${header("Post Analytics")}${p === undefined ? "" : article(p, state)}<div data-testid="analytics">${(
              [
                ["Impressions", "Impressions"],
                ["Engagements", "Engagements"],
                ["DetailExpands", "Detail expands"],
                ["ProfileVisits", "Profile visits"],
                ["LinkClicks", "Link clicks"],
              ] as const
            )
              .map(
                ([metric, label]) =>
                  `<div><span>${label}</span> <span>${(b?.analytics?.[metric] ?? 0).toLocaleString("en")}</span></div>`,
              )
              .join("")}</div>`,
        };
      }
      if (fourth === "quotes" || fourth === "retweets" || fourth === "likes") {
        const tab = fourth;
        return {
          title: "Post activity / X",
          requests: [
            tab === "quotes"
              ? r("SearchTimeline", {
                  rawQuery: quotesQuery(id),
                  count: 20,
                  querySource: "tdqt",
                  product: "Top",
                })
              : r(tab === "retweets" ? "Retweeters" : "Favoriters", { tweetId: id, count: 20 }),
          ],
          render: ([b]) =>
            `${header("Post activity")}${tabs("Post activity", [
              { label: "Quotes", href: `/${first}/status/${id}/quotes`, on: tab === "quotes" },
              { label: "Reposts", href: `/${first}/status/${id}/retweets`, on: tab === "retweets" },
              { label: "Likes", href: `/${first}/status/${id}/likes`, on: tab === "likes" },
            ])}<section data-list>${tab === "quotes" ? postsOf(b ?? null, state) : peopleOf(b ?? null)}</section>`,
        };
      }
      const sort = (q.get("sort_replies") ?? "relevance") as keyof typeof SORTS;
      const mode = MODES[sort] ?? "Relevance";
      return {
        title: "Post / X",
        requests: [
          r("TweetDetail", {
            focalTweetId: id,
            rankingMode: mode,
            with_rux_injections: false,
            includePromotedContent: true,
          }),
        ],
        render: ([b]) => {
          if (b === null || b === undefined)
            return `${header("Post")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`;
          const shown = b.order.flatMap((pid) => b.posts.find((p) => p.postId === pid) ?? []);
          return `${header("Post")}<section data-list>${shown
            .map((p) =>
              p.postId === id
                ? article(p, state, { focal: true, sort: SORTS[sort] ?? "Relevant" })
                : article(p, state),
            )
            .join(
              "",
            )}</section><div data-testid="inline_reply_offscreen">${editor(state, "Post your reply")}<button data-testid="tweetButtonInline" disabled>Reply</button></div>`;
        },
      };
    }
    if (second === "communities") {
      const explore = third === "explore";
      const feed = explore ? "CommunitiesExploreTimeline" : "CommunitiesRankedTimeline";
      return {
        title: "Communities / X",
        requests: [
          explore ? r("TopicCarouselQuery", {}) : r("CarouselQuery", {}),
          r(feed, { count: 20, withCommunity: true }),
          r("CommunitiesCreateButtonQuery", {}),
          // X fetches a card for each Community its posts are from.
          ...state
            .hubCommunities(feed)
            .map((communityId) => r("CommunitiesFetchOneQuery", { communityId })),
        ],
        paged: 1,
        // X's create button in its top bar: its form, or for an unverified account its upsell.
        render: ([carousel, b]) =>
          `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><h2 role="heading">Communities</h2><a href="/i/communities/suggested" aria-label="Search Communities">⌕</a><a href="${state.premium ? "/i/communities/create" : "/i/verified-get-verified"}" role="link"><svg aria-label="Create a new Community" viewBox="0 0 1 1"></svg></a></div>${tabs(
            "Communities",
            [
              { label: "Home", href: `/${first}/communities`, on: !explore },
              { label: "Explore", href: `/${first}/communities/explore`, on: explore },
            ],
          )}${
            explore
              ? "<h3>Discover new Communities</h3>"
              : `<h3>My Communities</h3><div data-testid="communitiesCarousel">${(
                  carousel?.communities ?? []
                )
                  .map(
                    (c) =>
                      `<a href="/i/communities/${c.communityId}" data-testid="communityTile"><img alt="" src="${esc(c.bannerUrl ?? "")}" class="avatar"><span>${esc(c.name)}</span></a>`,
                  )
                  .join("")}</div>`
          }<section data-list>${postsOf(b ?? null, state)}</section>`,
      };
    }
    if (second === "lists")
      return {
        title: "Lists / X",
        requests: [r("ListsManagementPageTimeline", { count: 100 })],
        render: ([b]) => {
          const groups = new Map<string, Array<EngineList>>();
          for (const l of b?.lists ?? [])
            groups.set(l.group ?? "", [...(groups.get(l.group ?? "") ?? []), l]);
          return `${header("Lists")}<input aria-label="Search Lists" placeholder="Search Lists"><section data-list>${[
            ...groups,
          ]
            .map(
              ([g, ls]) =>
                `<h3>${esc(g)}</h3>${ls.map(listRow).join("")}${g === "Discover new Lists" ? `<a href="/i/lists/discover">Show more</a>` : ""}`,
            )
            .join("")}</section>`;
        },
      };
    if (second === "about" && u !== undefined)
      return {
        title: `About @${u.handle} / X`,
        requests: [r("UserByScreenName", { screen_name: u.handle })],
        render: () =>
          `${header("About this account")}<div><h2>${esc(u.name)}</h2><div>@${esc(u.handle)}</div>${u.joinedAt === null ? "" : `<div>Date joined ${esc(new Date(u.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }))}</div>`}<div>Account based in ${esc(u.location ?? "Unknown")}</div></div>`,
      };
    const people = PEOPLE_TABS.find((t) => t.path === second);
    if (people !== undefined && u !== undefined) {
      const own = u.userId === state.viewer.userId;
      return {
        title: `${u.name} (@${u.handle}) / X`,
        requests: [
          r("UserByScreenName", { screen_name: u.handle }),
          r(people.op, {
            userId: u.userId,
            count: 20,
            includePromotedContent: false,
            withGrokTranslatedBio: true,
          }),
        ],
        render: ([head, b]) => {
          const live = head?.users[0] ?? state.user(u.userId) ?? u;
          return `${header(live.name)}${tabs(
            "People",
            PEOPLE_TABS.filter(
              (t) =>
                t.op !== "FollowersYouKnow" ||
                (!own && state.knownFollowers(u.userId).total_count > 0),
            ).map((t) => ({
              label: t.label,
              href: `/${live.handle}/${t.path}`,
              on: t === people,
            })),
          )}<section data-list>${peopleOf(b ?? null)}</section>`;
        },
      };
    }
    const tab =
      PROFILE_TABS.find((t) => t.path === (second === undefined ? "" : `/${second}`)) ??
      PROFILE_TABS[0];
    if (u === undefined)
      return {
        title: "Profile / X",
        requests: [r("UserByScreenName", { screen_name: first })],
        render: () =>
          `${header("Profile")}<div class="empty"><h3>This account doesn't exist</h3><div>Try searching for another.</div></div>`,
      };
    const own = u.userId === state.viewer.userId;
    return {
      title: `${u.name} (@${u.handle}) / X`,
      requests: [
        r("UserByScreenName", { screen_name: u.handle }),
        r(tab.op, { userId: u.userId, count: 20, includePromotedContent: true }),
        // X asks every profile for a schedule over the weeks around now.
        r("UserSportsProfile", {
          rest_id: u.userId,
          start_time: String(Date.now() - 14 * 86_400_000),
          end_time: String(Date.now() + 14 * 86_400_000),
        }),
      ],
      // Who of the people the viewer follows follow them ("Followed by"), for others' profiles.
      ...(own
        ? {}
        : {
            rest: [
              `/i/api/1.1/friends/following/list.json?include_profile_interstitial_type=1&skip_status=1&user_id=${u.userId}&count=3&with_total_count=true`,
            ],
          }),
      render: ([head, b, sports]) => {
        const live = head?.users[0] ?? state.user(u.userId) ?? u;
        const bell = state.bellOn(live.userId);
        const buttons = own
          ? `<a href="/settings/profile" data-testid="editProfileButton">Edit profile</a>`
          : `<button data-testid="userActions" aria-label="More" aria-haspopup="menu" aria-expanded="false" data-menu="profile:${esc(live.handle)}">…</button>
             <a href="/messages/compose?recipient_id=${live.userId}" data-testid="sendDMFromProfile" aria-label="Message">✉</a>
             ${live.youFollow ? `<button aria-label="${bell ? "Turn off post notifications" : "Turn on post notifications"}" data-bell="${live.userId}">🔔</button>` : ""}
             <span>${followButton(live)}</span>
             ${state.isCreator(live.userId) ? `<button aria-label="Subscribe to @${esc(live.handle)}" data-subscribe="${live.userId}">Subscribe</button>` : ""}`;
        return `${header(live.name)}<div data-testid="UserProfileHeader_Items">
          <img alt="" src="${esc(live.bannerUrl ?? "")}" class="banner-img">
          <div class="profile-row">${avatar(live.avatarUrl, live.handle)}<div class="profile-actions">${buttons}</div></div>
          <div data-testid="UserName"><div><span>${esc(live.name)}</span></div><div><span>@${esc(live.handle)}</span></div></div>
          <div data-testid="UserDescription">${esc(live.bio)}</div>
          <div class="muted">${live.joinedAt === null ? "" : `Joined ${esc(new Date(live.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }))}`}</div>
          <div><a href="/${esc(live.handle)}/following"><b>${compact(live.following)}</b> Following</a> <a href="/${esc(live.handle)}/verified_followers"><b>${compact(live.followers)}</b> Followers</a></div>
        </div>${
          (sports?.games ?? []).length === 0
            ? ""
            : `<div data-testid="nflProfileScheduleCarousel"><button aria-label="Previous">‹</button>${sports!
                .games!.map(
                  // Buttons named "<away> at <home>. <status>", with no link to the game.
                  (g) =>
                    `<button data-testid="nflProfileScheduleGameCard" aria-label="${esc(`${g.away.name ?? ""} at ${g.home.name ?? ""}. ${gameState(g)}`)}" data-href="/i/nba/game/${g.gameId}"><div>${esc(gameState(g))}</div>${gameSides(g)}</button>`,
                )
                .join("")}<button aria-label="Next">›</button></div>`
        }${tabs(
          "Profile timelines",
          PROFILE_TABS.filter((t) => t.label !== "Subs" || state.isCreator(live.userId)).map(
            (t) => ({
              label: t.label,
              href: `/${live.handle}${t.path}`,
              on: t === tab,
            }),
          ),
        )}
        ${tab.label === "Subs" ? `<h2>${esc(live.name)}'s Subscription posts</h2>` : ""}${
          b?.prompt === undefined
            ? ""
            : `<div data-testid="subscribePrompt"><h3>${esc(b.prompt.header)}</h3><div>${esc(b.prompt.body)}</div>${b.prompt.button === null ? "" : `<button data-subscribe="${live.userId}">${esc(b.prompt.button.text)}</button>`}</div>`
        }<section data-list>${postsOf(b ?? null, state)}</section>`;
      },
    };
  }
  return {
    title: "X",
    requests: [],
    render: () =>
      `${header("Page")}<div class="empty"><h3>Hmm...this page doesn't exist.</h3></div>`,
  };
}
