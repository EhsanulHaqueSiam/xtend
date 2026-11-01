import type {
  EngineBatch,
  EngineCommunity,
  EngineList,
  EngineModule,
  EngineNotification,
  EnginePost,
  EngineTrend,
  EngineUser,
} from "@xtend/contracts";

import { type GraphqlRequest, type MockState, quotesQuery } from "./state.ts";

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
    <button data-testid="caret" aria-label="More" aria-haspopup="menu" aria-expanded="false" data-menu="post:${p.postId}">…</button></div>
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

const listRow = (l: EngineList) =>
  `<div data-testid="listCell" role="link" tabindex="0" data-href="/i/lists/${l.listId}"><div>${esc(l.name)}${l.isPrivate ? " 🔒" : ""}</div><div class="muted">${compact(l.members)} members · ${compact(l.followers)} followers${l.owner === null ? "" : ` including @${esc(l.owner.handle)}`}</div></div>`;

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

const COMMUNITY_TABS = [
  { path: "", label: "Top" },
  { path: "/latest", label: "Latest" },
  { path: "/media", label: "Media" },
  { path: "/about", label: "About" },
] as const;

/** A page's list body: its posts in X's order, with what the capture lists around them. */
export const postsOf = (b: EngineBatch | null, state: MockState) =>
  b === null
    ? ""
    : b.order
        .flatMap((id) => {
          const p = b.posts.find((post) => post.postId === id);
          if (p !== undefined) return [article(p, state)];
          const m = b.modules.find((module) => module.id === id);
          return m === undefined ? [] : [whoToFollow(m, b)];
        })
        .join("");
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

interface Route {
  readonly title: string;
  readonly requests: ReadonlyArray<GraphqlRequest>;
  /** Which request pages on scroll, by its index; none for a page that is one answer. */
  readonly paged?: number | undefined;
  readonly render: (batches: ReadonlyArray<EngineBatch | null>) => string;
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
  { path: "/superfollows", op: "UserSuperFollowTweets", label: "Subs" },
  { path: "/highlights", op: "UserHighlightsTweets", label: "Highlights" },
  { path: "/media", op: "UserMedia", label: "Media" },
] as const;
const SORTS = { relevance: "Relevant", recency: "Recent", likes: "Likes" } as const;
const MODES = { relevance: "Relevance", recency: "Recency", likes: "Likes" } as const;

/** A full-page dialog X opens as its own route (Report, Send via Chat, the composer). */
const routeDialog = (title: string, body: string) =>
  `<div role="dialog" aria-modal="true" aria-labelledby="dialog-title" class="dialog route"><div class="bar"><button data-testid="app-bar-close" aria-label="Close">✕</button><h2 id="dialog-title">${esc(title)}</h2></div>${body}</div>`;

/** The route for an x.com path (with its query), and Home's picked tab. */
export function route(state: MockState, pathWithQuery: string, homeTab: string): Route {
  const url = new URL(pathWithQuery, "https://x.com");
  const q = url.searchParams;
  const parts = url.pathname.split("/").filter(Boolean);
  const [first = "", second, third, fourth] = parts;
  const r = (op: string, variables: Record<string, unknown>): GraphqlRequest => ({ op, variables });
  const lower = first.toLowerCase();

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
        <div class="composer"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" aria-label="Post text" data-placeholder="What's happening?"></div><div data-testid="toolBar"><button data-testid="tweetButtonInline" disabled>Post</button></div></div>
        <section data-list>${postsOf(b ?? null, state)}</section>`,
    };
  }
  if (url.pathname === "/i/bookmarks")
    return {
      title: "Bookmarks / X",
      requests: [r("Bookmarks", { count: 20, includePromotedContent: true })],
      render: ([b]) => {
        const list = postsOf(b ?? null, state);
        return `${header("All Bookmarks")}<input aria-label="Search Bookmarks" placeholder="Search Bookmarks"><section data-list>${
          list === ""
            ? `<div class="empty"><h3>Bookmark posts to save them for later</h3><button>New folder</button></div>`
            : list
        }</section>`;
      },
    };
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
          .join(
            "",
          )}${b != null && b.people.length > 0 ? `<h3>Who to follow</h3>${peopleOf(b)}` : ""}</section>`,
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
            : `<div data-testid="listHeader"><img alt="" src="${esc(l.bannerUrl ?? "")}" class="banner-img"><h2>${esc(l.name)}</h2><div>${esc(l.description)}</div>${l.owner === null ? "" : `<div><a href="/${esc(l.owner.handle)}">${esc(l.owner.name)}</a> @${esc(l.owner.handle)}</div>`}<div><a href="/i/lists/${l.listId}/members"><b>${compact(l.members)}</b> Members</a> <a href="/i/lists/${l.listId}/followers"><b>${compact(l.followers)}</b> Followers</a></div><button data-testid="listFollow">Follow</button></div>`
        }<section data-list>${postsOf(b ?? null, state)}</section>`;
      },
    };
  }
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
    const tab = COMMUNITY_TABS.find((t) => t.path === (fourth === undefined ? "" : `/${fourth}`));
    const id = third;
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
        return `<div class="bar"><button data-testid="app-bar-back" aria-label="Back">←</button><h2 role="heading">${esc(c.name)}</h2><a href="/i/communities/${id}/search" aria-label="Search Community">⌕</a><button aria-label="More">…</button></div><div data-testid="communityHeader"><img alt="" src="${esc(c.bannerUrl ?? "")}" class="banner-img"><h2>${esc(c.name)}</h2><a href="/i/communities/${c.communityId}/members"><b>${compact(c.members)}</b> Members</a><button aria-label="${pin}" data-community-pin="${id}">📌</button><button aria-label="Share Community">⤴</button>${joinButton(c, state.communityRequested(id))}</div>${tabs(
          "Community",
          COMMUNITY_TABS.map((t) => ({
            label: t.label,
            href: `/i/communities/${id}${t.path}`,
            on: t === tab,
          })),
        )}<section data-list>${tab.label === "About" ? about : postsOf(b ?? null, state)}</section>`;
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
  if (lower === "compose")
    return {
      title: "Compose new post / X",
      requests: [],
      render: () =>
        routeDialog(
          "",
          `<div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" aria-label="Post text" data-placeholder="What's happening?"></div><div data-testid="toolBar"><button data-testid="tweetButton">Post</button></div>`,
        ),
    };

  if (first !== "" && !RESERVED.has(lower)) {
    const u = state.byHandle(first);
    if (second === "status" && third !== undefined) {
      const id = third;
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
            )}</section><div data-testid="inline_reply_offscreen"><div data-testid="tweetTextarea_0" contenteditable="true" role="textbox" aria-label="Post text" data-placeholder="Post your reply"></div><button data-testid="tweetButtonInline" disabled>Reply</button></div>`;
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
          // X fetches a card for each Community its posts are from.
          ...state
            .hubCommunities(feed)
            .map((communityId) => r("CommunitiesFetchOneQuery", { communityId })),
        ],
        paged: 1,
        render: ([carousel, b]) =>
          `${header("Communities")}${tabs("Communities", [
            { label: "Home", href: `/${first}/communities`, on: !explore },
            { label: "Explore", href: `/${first}/communities/explore`, on: explore },
          ])}${
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
      ],
      render: ([head, b]) => {
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
        </div>${tabs(
          "Profile timelines",
          PROFILE_TABS.map((t) => ({
            label: t.label,
            href: `/${live.handle}${t.path}`,
            on: t === tab,
          })),
        )}
        <section data-list>${postsOf(b ?? null, state)}</section>`;
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
