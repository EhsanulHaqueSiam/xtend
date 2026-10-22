import { expect, it } from "vite-plus/test";

import {
  articleActionRow,
  articleAuthorHandle,
  articleHoverTargets,
  articlePostId,
  findArticles,
  isDmPath,
} from "./xDom.ts";

// Trimmed by hand from x.com/jack/status/20 on 2026-10-23 (X_DOM_VERSION 2026-10):
// the wrappers between the landmarks are dropped, the landmarks and their order are real.
const FIXTURE = `
<div>
  <article data-testid="tweet" role="article">
    <div data-testid="Tweet-User-Avatar">
      <div data-testid="UserAvatar-Container-jack"><a role="link" href="/jack"></a></div>
    </div>
    <div data-testid="User-Name">
      <a role="link" href="/jack"><span>jack</span></a>
      <a role="link" href="/jack"><span>@jack</span></a>
      <button data-testid="caret" role="button" aria-label="More"></button>
    </div>
    <div data-testid="tweetText"><span>just setting up my twttr</span></div>
    <div role="link"><span>quoted post</span><time datetime="2006-03-21T20:50:14.000Z">2:50 AM</time></div>
    <a role="link" href="/jack/status/20" aria-label="2:50 AM · Mar 22, 2006">
      <time datetime="2006-03-21T20:50:14.000Z">2:50 AM · Mar 22, 2006</time>
    </a>
    <div role="group" aria-label="18109 replies, 131908 reposts, 311870 likes, 21978 bookmarks">
      <button data-testid="reply" role="button" aria-label="18109 Replies. Reply"></button>
      <button data-testid="retweet" role="button" aria-label="131908 reposts. Repost"></button>
      <button data-testid="like" role="button" aria-label="311870 Likes. Like"></button>
      <button data-testid="bookmark" role="button" aria-label="21978 Bookmarks. Bookmark"></button>
    </div>
    <a role="link" href="/jack/status/20/quotes">View quotes</a>
  </article>
  <div data-testid="inline_reply_offscreen"><div role="group"></div></div>
</div>`;

it("reads the post id, author, action row and hover targets from a real article", () => {
  document.body.innerHTML = FIXTURE;
  const articles = findArticles(document);
  expect(articles).toHaveLength(1);
  const article = articles[0]!;
  // The quotes link also contains /status/ but wraps no <time>; the quoted post has a time but no link.
  expect(articlePostId(article)).toBe("20");
  expect(articleAuthorHandle(article)).toBe("jack");
  expect(articleActionRow(article)?.getAttribute("aria-label")).toContain("311870 likes");
  expect(articleHoverTargets(article).map((e) => e.getAttribute("data-testid"))).toEqual([
    "Tweet-User-Avatar",
    "User-Name",
  ]);
});

it("yields null rather than a guess when the landmarks are gone", () => {
  document.body.innerHTML = `<article data-testid="tweet"><div>renamed everything</div></article>`;
  const article = findArticles(document)[0]!;
  expect(articlePostId(article)).toBeNull();
  expect(articleAuthorHandle(article)).toBeNull();
  expect(articleActionRow(article)).toBeNull();
});

it("treats direct messages as off limits", () => {
  expect(isDmPath("/messages/123")).toBe(true);
  expect(isDmPath("/home")).toBe(false);
});
