import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's own X screens on the desktop, with mock X as the engine: what the screens draw is what
 * mock X's page fetched, in X's order, and a click in Xtend presses mock X's own button. The mock
 * tier of `apps/desktop/scripts/engine-bench.mjs`, which stays the real-account proof.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine();
});
afterAll(() => e?.close());

/** Opens an Xtend route, as the sidebar or a link does. */
const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const nativeIds = () =>
  e.app
    .locator("main article[data-post]")
    .evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.post));
const nativeHandles = () =>
  e.app
    .locator('main [data-x="user"] button[aria-label^="@"]')
    .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")!.slice(1)));
const enginePath = () => e.engine<string>("location.pathname + location.search");
const engineHas = (selector: string) =>
  e.engine<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
/** X's article for a post on the engine page, by its timestamp link, as `x.ts` finds it. */
const xArticle = (id: string) =>
  `document.querySelector('article a[href$="/status/${id}"] time')?.closest("article")`;
const presses = () =>
  e.mock.state.presses.map((p) => `${p.kind} ${p.name} ${p.target ?? ""}`.trim());
/** X's menu rows as Xtend's menu shows them, once read from X. */
const appMenuRows = () =>
  e.app
    .locator('[role="menu"] [role="menuitem"]')
    .allTextContents()
    .then((rows) => (rows.includes("Loading from X") ? [] : rows));
const pane = () => e.app.locator('section[aria-label="x.com"]').getAttribute("data-mode");

test("Home renders mock X's Following and For you in X's order, with the engine on X's Home", async () => {
  const following = e.mock.state.feed("following");
  await go("/home?feed=following");
  await expect.poll(async () => (await nativeIds()).slice(0, 4)).toEqual(following.slice(0, 4));
  await expect.poll(enginePath).toBe("/home");
  expect(
    await e.engine(
      `document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()`,
    ),
  ).toBe("Following");

  await go("/home?feed=forYou");
  await expect
    .poll(async () => (await nativeIds()).slice(0, 3))
    .toEqual(e.mock.state.feed("forYou").slice(0, 3));
  await expect
    .poll(() =>
      e.engine(`document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()`),
    )
    .toBe("For you");
  // The engine took no request off the machine, nor did the app page.
  expect(
    await e.engine(`fetch("https://example.com/").then((r) => r.status, () => "refused")`),
  ).toBe(404);
  expect(
    await e.app.evaluate(() =>
      fetch("https://example.com/").then(
        (r) => r.status,
        () => "refused",
      ),
    ),
  ).toBe("refused");
});

test("For you draws X's Who to follow under the post X put it after, and its Follow presses X's own button", async () => {
  const { module, after } = e.mock.state.whoToFollow("forYou")!;
  const people = e.mock.state
    .fixtures()
    .home!.batches.flatMap((b) => b.users)
    .filter((u) => module.userIds.includes(u.userId));
  await go("/home?feed=forYou");
  const box = e.app.locator('main [data-x="module"]');
  await box.waitFor();
  expect(
    await box.evaluate(
      (m) =>
        m
          .closest("[data-index]")
          ?.previousElementSibling?.querySelector<HTMLElement>("article[data-post]")?.dataset.post,
    ),
  ).toBe(after);
  expect(
    await box
      .locator('[data-x="user"] button[aria-label^="@"]')
      .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")!.slice(1))),
  ).toEqual(module.userIds.slice(0, 3).map((id) => people.find((u) => u.userId === id)!.handle));

  const [target] = module.userIds;
  await box
    .locator('[data-x="user"]')
    .first()
    .getByRole("button", { name: "Follow", exact: true })
    .click();
  await expect
    .poll(presses)
    .toEqual(
      expect.arrayContaining([
        `press ${target}-follow ${target}`,
        `write friendships/create ${target}`,
      ]),
    );
  await expect
    .poll(() =>
      box.locator('[data-x="user"]').first().getByRole("button", { pressed: true }).count(),
    )
    .toBe(1);
  await expect.poll(enginePath).toBe("/home");
});

test("Home's pinned tabs are read from X and switch through the engine", async () => {
  const [design] = e.mock.state.pinnedTabs;
  const tab = e.app.getByRole("tab", { name: design!.label });
  await tab.click();
  const ids = e.mock.state.batchFor("HomeTimeline", {
    tag: design!.id.slice("tag:".length),
  })!.order;
  await expect.poll(nativeIds).toEqual(ids);
  expect(
    await e.engine(
      `document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()`,
    ),
  ).toBe(design!.label);
});

test("For you pages through X's next page at the list's end, and newer posts wait behind Show N posts", async () => {
  await go("/home?feed=forYou");
  const next = e.mock.state.feedPageIds("forYou", 2);
  // The native list's end asks the engine to scroll X's page, which fetches its next page.
  await expect
    .poll(async () => {
      await e.app.evaluate(() => {
        const s = document.querySelector("main [data-virtuoso-scroller]");
        if (s !== null) s.scrollTop = s.scrollHeight;
      });
      return nativeIds();
    })
    .toEqual(expect.arrayContaining([...next]));

  await e.app.evaluate(() => {
    const s = document.querySelector("main [data-virtuoso-scroller]");
    if (s !== null) s.scrollTop = 0;
  });
  // The virtualized list redraws after the scroll: until then its first row is one from further
  // down. The top is X's first post, so wait for the list to draw it there.
  const top = e.mock.state.feed("forYou")[0];
  await expect.poll(async () => (await nativeIds())[0]).toBe(top);
  const fresh = e.mock.state.arrive("forYou", 2).map((p) => p.postId);
  // X loading its first page again under an open list is what its "Show 2 posts" fetch is.
  await e.engine("location.reload()");
  const pill = e.app.getByRole("button", { name: /Show 2 posts/ });
  await pill.waitFor();
  expect((await nativeIds())[0]).toBe(top);
  await pill.click();
  await expect.poll(async () => (await nativeIds()).slice(0, 2)).toEqual(fresh);
});

test("A bookmark presses mock X's own button in place, and pressing again takes it back", async () => {
  await go("/home?feed=following");
  const id = e.mock.state
    .feed("following")
    .find((pid) => e.mock.state.post(pid)?.bookmarked === false)!;
  const button = e.app.locator(`main [data-post="${id}"] button[aria-label="Bookmark on X"]`);
  await expect.poll(() => engineHas(`article a[href$="/status/${id}"] time`)).toBe(true);
  await button.click();
  await expect
    .poll(presses)
    .toEqual(expect.arrayContaining([`press bookmark ${id}`, `write CreateBookmark ${id}`]));
  expect(await e.engine(`!!${xArticle(id)}.querySelector('[data-testid="removeBookmark"]')`)).toBe(
    true,
  );
  // In place: the engine never left the list it feeds.
  expect(await enginePath()).toBe("/home");
  expect(e.mock.state.post(id)?.bookmarked).toBe(true);

  // Xtend takes no second press on a button while X is still saving the first.
  const undone = () => presses().includes(`press removeBookmark ${id}`);
  await expect
    .poll(async () => {
      if (!undone()) await button.click();
      return presses();
    })
    .toEqual(expect.arrayContaining([`press removeBookmark ${id}`, `write DeleteBookmark ${id}`]));
  expect(presses().filter((p) => p === `press removeBookmark ${id}`)).toHaveLength(1);
  expect(await e.engine(`!!${xArticle(id)}.querySelector('[data-testid="bookmark"]')`)).toBe(true);
  expect(e.mock.state.post(id)?.bookmarked).toBe(false);
});

test("A post's ... lists mock X's own rows, read and closed on the engine, and Report opens X's page over the main area", async () => {
  await go("/home?feed=following");
  const id = e.mock.state.feed("following")[0]!;
  const want = (await (await fetch(`${e.mock.url}/__mock/menu?spec=post:${id}`)).json()) as Array<{
    label: string;
  }>;
  await e.app.locator(`main [data-post="${id}"] button[aria-label="More"]`).click();
  await expect.poll(appMenuRows).toEqual(expect.arrayContaining(want.map((r) => r.label)));
  // The mock page logs a press over HTTP, a moment after it happened.
  await expect
    .poll(presses)
    .toEqual(expect.arrayContaining([`press menu:post:${id}`, "press menu:closed"]));
  expect(await engineHas('[data-testid="Dropdown"]')).toBe(false);

  await e.app.getByRole("menuitem", { name: "Report post", exact: true }).click();
  await expect.poll(pane).toBe("main");
  expect(await enginePath()).toBe(`/i/safety/report_story_start?tweet_id=${id}`);
  expect(await engineHas('[role="dialog"]')).toBe(true);
  // Out of X's report the way its own close does, before any choice is made.
  await e.engine(`document.querySelector('[data-testid="app-bar-close"]').click()`);
  await expect.poll(pane).toBe("hidden");
  expect(await enginePath()).toBe("/home");
});

test("Follow from a post's ... presses X's own row, and Xtend holds what X's menu says after", async () => {
  const id = e.mock.state.feed("following").find((pid) => {
    const author = e.mock.state.post(pid)!.author;
    return e.mock.state.user(author.userId)?.youFollow === false;
  })!;
  const author = e.mock.state.post(id)!.author;
  // The post's own page draws Follow beside its author until Xtend holds that the user follows.
  await go(`/post/${id}?h=${author.handle}`);
  const post = e.app.locator(`main [data-post="${id}"]`).first();
  const follow = post.getByRole("button", { name: "Follow", exact: true });
  await follow.waitFor();
  await expect.poll(enginePath).toBe(`/${author.handle}/status/${id}`);

  await post.locator('button[aria-label="More"]').click();
  await e.app.getByRole("menuitem", { name: `Follow @${author.handle}`, exact: true }).click();
  // X's menu is opened to press the row, and once more after X took it, to read what it says now.
  const order = () => {
    const log = presses();
    const at = (entry: string, from = 0) => log.indexOf(entry, from);
    const write = at(`write friendships/create ${author.userId}`);
    return [
      at(`press menu:post:${id}`) < at(`press row:Follow @${author.handle} post:${id}`),
      at(`press row:Follow @${author.handle} post:${id}`) < write,
      write !== -1 && at(`press menu:post:${id}`, write) !== -1,
    ];
  };
  await expect.poll(order).toEqual([true, true, true]);
  // Nothing refetched the author meanwhile: only that read can tell Xtend the follow went through.
  await expect.poll(() => follow.count()).toBe(0);
  expect(e.mock.state.user(author.userId)?.youFollow).toBe(true);
});

test("A post opens with its replies, and Recent re-sorts them as X's page orders them", async () => {
  const focal = e.mock.state.fixtures().post!.batches[0]!;
  const id = focal.key!;
  const handle = focal.posts[0]!.author.handle;
  await go(`/post/${id}?h=${handle}`);
  await expect.poll(nativeIds).toEqual(focal.order);
  await expect.poll(enginePath).toBe(`/${handle}/status/${id}`);

  await e.app.locator("main button", { hasText: /^Relevant$/ }).click();
  await e.app.locator('[role="menu"] [role="menuitem"]', { hasText: /^Recent$/ }).click();
  const recent = e.mock.state.batchFor("TweetDetail", {
    focalTweetId: id,
    rankingMode: "Recency",
  })!.order;
  await expect.poll(enginePath).toBe(`/${handle}/status/${id}?sort_replies=recency`);
  await expect.poll(nativeIds).toEqual(recent);
  const xOrder = await e.engine<Array<string>>(
    `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href").split("/status/")[1])`,
  );
  expect(xOrder).toEqual(recent);
});

test("A profile renders X's header and posts; its ... rows come from X, its bell is X's, and About opens X's page", async () => {
  const user = e.mock.state.people[0]!;
  await go(`/u/${user.handle}`);
  const profile = e.app.locator('main [data-x="profile"]');
  await profile.getByText(user.bio).waitFor();
  const posts = e.mock.state.batchFor("UserTweets", { userId: user.userId })!.order;
  await expect.poll(nativeIds).toEqual(posts);
  expect(await enginePath()).toBe(`/${user.handle}`);

  // Someone the account follows: X draws the bell, and Xtend's says the same.
  const bell =
    '[aria-label="Turn on post notifications"], [aria-label="Turn off post notifications"]';
  await expect
    .poll(() => profile.locator(bell).getAttribute("aria-label"))
    .toBe(await e.engine(`document.querySelector('${bell}').getAttribute("aria-label")`));

  await profile.locator('button[aria-label="More"]').click();
  await expect
    .poll(appMenuRows)
    .toEqual(
      expect.arrayContaining([
        "About this account",
        "Mute",
        `Block @${user.handle}`,
        `Report @${user.handle}`,
      ]),
    );
  expect(await engineHas('[data-testid="Dropdown"]')).toBe(false);
  await e.app.getByRole("menuitem", { name: "About this account", exact: true }).click();
  await expect.poll(enginePath).toBe(`/${user.handle}/about`);
  await expect.poll(pane).toBe("main");
  await e.engine(`document.querySelector('[data-testid="app-bar-back"]').click()`);
  await expect.poll(pane).toBe("hidden");
  expect(await enginePath()).toBe(`/${user.handle}`);
});

test("The Follow page lists X's two tabs with X's buttons, and Follow presses <id>-follow on the engine", async () => {
  await go("/follow");
  const who = e.mock.state.batchFor("ConnectTabTimeline", { context: "{}" })!.people;
  const handleOf = (id: string) =>
    e.mock.state.user(id)?.handle ??
    e.mock.state.fixtures().follow!.batches[0]!.users.find((u) => u.userId === id)!.handle;
  await expect.poll(nativeHandles).toEqual(who.map(handleOf));
  await expect.poll(enginePath).toBe("/i/connect_people");

  const target = e.mock.state.fixtures().follow!.batches[0]!.users.find((u) => !u.youFollow)!;
  await e.app
    .locator('main [data-x="user"]', { hasText: `@${target.handle}` })
    .getByRole("button", { name: "Follow", exact: true })
    .click();
  await expect
    .poll(presses)
    .toEqual(
      expect.arrayContaining([
        `press ${target.userId}-follow ${target.userId}`,
        `write friendships/create ${target.userId}`,
      ]),
    );
  expect(await engineHas(`[data-testid="${target.userId}-unfollow"]`)).toBe(true);

  await go("/follow?tab=creators");
  const creators = e.mock.state.batchFor("ConnectTabTimeline", {
    context: JSON.stringify({ isCreatorOnlyConnectTab: true }),
  })!.people;
  await expect.poll(nativeHandles).toEqual(creators.map(handleOf));
  await expect.poll(enginePath).toBe("/i/connect_people?is_creator_only=true");
  expect(await engineHas(`[data-testid="${creators[0]}-subscribe"]`)).toBe(true);

  // A creator X's page does not draw near its scroll: Subscribe goes to their profile, where X
  // labels it "Subscribe to @handle", and X's dialog shows over the main area until it closes.
  const far = e.mock.state.user(creators[3]!)!;
  expect(await engineHas(`[data-testid="${far.userId}-subscribe"]`)).toBe(false);
  await e.app
    .locator('main [data-x="user"]', { hasText: `@${far.handle}` })
    .getByRole("button", { name: "Subscribe", exact: true })
    .click();
  await expect.poll(enginePath).toBe(`/${far.handle}`);
  await expect.poll(() => engineHas('#layers [role="dialog"]')).toBe(true);
  await expect.poll(pane).toBe("main");
  await expect.poll(presses).toEqual(expect.arrayContaining([`press subscribe ${far.userId}`]));
  await e.engine(`document.querySelector('#layers [data-testid="app-bar-close"]').click()`);
  await expect.poll(pane).toBe("hidden");
  await expect.poll(enginePath).toBe("/i/connect_people?is_creator_only=true");
});

test("Communities: the hub's Home and Explore, and a Community's tabs, read X's pages", async () => {
  const hub = `/${e.mock.state.viewer.handle}/communities`;
  await go("/communities");
  await expect.poll(enginePath).toBe(hub);
  const read = (op: string, variables: Record<string, unknown> = {}) =>
    e.mock.state.batchFor(op, variables)!;
  await expect.poll(nativeIds).toEqual(read("CommunitiesRankedTimeline").order);
  await expect
    .poll(() => e.app.locator('main [data-x="community-tile"]').allTextContents())
    .toEqual(read("CarouselQuery").communities.map((c) => c.name));

  await e.app.getByRole("tab", { name: "Explore", exact: true }).click();
  await expect.poll(enginePath).toBe(`${hub}/explore`);
  const explore = read("CommunitiesExploreTimeline");
  await expect.poll(nativeIds).toEqual(explore.order);
  // X labels each post with the Community it is from.
  await e.app.locator("main").getByText(explore.posts[0]!.context!.text).first().waitFor();

  // The Community the fixtures give a page of its own.
  const community = e.mock.state
    .fixtures()
    .communities!.batches.find((b) => b.op === "CommunityQuery")!.communities[0]!;
  const id = community.communityId;
  await go(`/communities/${id}`);
  await expect.poll(enginePath).toBe(`/i/communities/${id}`);
  const header = e.app.locator('main [data-x="community"]');
  await header.getByText("Members").waitFor();
  expect(await header.innerText()).toContain(community.name);
  const tweets = (rankingMode: string) =>
    read("CommunityTweetsTimeline", { communityId: id, rankingMode }).order;
  await expect.poll(nativeIds).toEqual(tweets("Relevance"));

  const tab = async (label: string, path: string) => {
    await e.app.getByRole("tab", { name: label, exact: true }).click();
    await expect.poll(enginePath).toBe(`/i/communities/${id}${path}`);
  };
  await tab("Latest", "/latest");
  await expect.poll(nativeIds).toEqual(tweets("Recency"));
  await tab("Media", "/media");
  await expect.poll(nativeIds).toEqual(read("CommunityMediaTimeline", { communityId: id }).order);
  await tab("About", "/about");
  const about = read("CommunityAboutTimeline", { communityId: id });
  await expect
    .poll(nativeHandles)
    .toEqual(about.people.map((u) => about.users.find((x) => x.userId === u)!.handle));
  await e.app
    .locator('main [data-x="community-about"]')
    .getByText(community.rules![0]!.name)
    .waitFor();
});

test("Join presses X's own Join, and Ask to join shows X's rules over the main area", async () => {
  const communities = e.mock.state
    .fixtures()
    .communities!.batches.flatMap((b) =>
      b.op === "CommunitiesFetchOneQuery" ? b.communities : [],
    );
  const open = communities.find((c) => c.role === "NonMember" && c.joinPolicy === "Open")!;
  const asks = communities.find((c) => c.role === "NonMember" && c.joinPolicy !== "Open")!;
  const membership = (label: string) =>
    e.app.locator('main [data-x="community"]').getByRole("button", { name: `${label} ` });

  await go(`/communities/${open.communityId}`);
  await expect.poll(enginePath).toBe(`/i/communities/${open.communityId}`);
  await membership("Join").click();
  await expect
    .poll(presses)
    .toEqual(
      expect.arrayContaining([
        `press communityJoin:Join ${open.communityId}`,
        `write JoinCommunity ${open.communityId}`,
      ]),
    );
  await membership("Joined").waitFor();
  expect(e.mock.state.community(open.communityId)!.role).toBe("Member");

  // Leaving: X's confirm shows over the main area, and Xtend says Join as X does, also back on X's
  // cached page, which fetches nothing to say so.
  const confirm = `document.querySelector('#layers [data-testid="confirmationSheetConfirm"]')`;
  await membership("Joined").click();
  await expect.poll(() => e.engine(`!!${confirm}`)).toBe(true);
  await expect.poll(pane).toBe("main");
  await e.engine(`${confirm}.click()`);
  await expect.poll(pane).toBe("hidden");
  await membership("Join").waitFor();
  expect(presses()).toContain(`write LeaveCommunity ${open.communityId}`);
  await go("/communities");
  await expect.poll(enginePath).toBe(`/${e.mock.state.viewer.handle}/communities`);
  await go(`/communities/${open.communityId}`);
  await expect.poll(enginePath).toBe(`/i/communities/${open.communityId}`);
  await membership("Join").waitFor();

  // Joined again, then left on x.com itself: Xtend's Joined no longer matches X's button, so
  // pressing it presses nothing on X and takes X's word.
  await membership("Join").click();
  await membership("Joined").waitFor();
  await e.engine(`document.querySelector('[data-community-join="${open.communityId}"]').click()`);
  await expect.poll(() => e.engine(`!!${confirm}`)).toBe(true);
  await e.engine(`${confirm}.click()`);
  await expect
    .poll(() => presses().filter((p) => p === `write LeaveCommunity ${open.communityId}`).length)
    .toBe(2);
  const before = presses().length;
  await membership("Joined").click();
  await membership("Join").waitFor();
  expect(presses().slice(before)).toEqual([]);

  await go(`/communities/${asks.communityId}`);
  await expect.poll(enginePath).toBe(`/i/communities/${asks.communityId}`);
  await membership("Ask to join").click();
  await expect.poll(() => engineHas('#layers [role="dialog"]')).toBe(true);
  await expect.poll(pane).toBe("main");
  expect(presses()).toContain(`press communityJoin:Ask to join ${asks.communityId}`);
  // The user closes X's rules without asking: nothing was sent, and the screen is back.
  await e.engine(`document.querySelector('#layers [data-testid="app-bar-close"]').click()`);
  await expect.poll(pane).toBe("hidden");
  expect(presses()).not.toContain(`write RequestToJoinCommunity ${asks.communityId}`);
  await membership("Ask to join").waitFor();
});

test("Search reads X's Top and People tabs for the query", async () => {
  const q = "design system";
  await go(`/search?q=${encodeURIComponent(q)}&f=top`);
  await expect
    .poll(nativeIds)
    .toEqual(e.mock.state.batchFor("SearchTimeline", { product: "Top", rawQuery: q })!.order);
  await go(`/search?q=${encodeURIComponent(q)}&f=people`);
  const people = e.mock.state.batchFor("SearchTimeline", { product: "People", rawQuery: q })!;
  await expect
    .poll(nativeHandles)
    .toEqual(people.people.map((id) => people.users.find((u) => u.userId === id)!.handle));
  await expect.poll(enginePath).toBe(`/search?q=${encodeURIComponent(q)}&src=typed_query&f=user`);
});

test("Advanced search writes X's operators, and X's SearchTimeline runs them", async () => {
  const form = e.app.getByRole("dialog", { name: "Advanced search" });
  const allWords = () => form.getByLabel("All of these words").inputValue();
  const fromPalette = async () => {
    await e.app.keyboard.press("Control+k");
    await e.app.getByRole("option", { name: "Advanced search", exact: true }).click();
  };
  // From the palette over an open search, the form edits that search on its tab; elsewhere it is empty.
  await go(`/search?q=design&f=latest`);
  await fromPalette();
  await expect.poll(allWords).toBe("design");
  expect(await e.app.evaluate(() => location.hash)).toContain("f=latest");
  await form.getByRole("button", { name: "Close" }).click();
  await go("/home?feed=following");
  await fromPalette();
  await expect.poll(allWords).toBe("");
  await form.getByRole("button", { name: "Close" }).click();

  // The box's typed, unsent text is what the form opens with.
  await go(`/search?q=design&f=top`);
  await e.app.getByLabel("Search X").fill("design system");
  await e.app.locator("main").getByRole("button", { name: "Advanced search" }).click();
  await expect.poll(allWords).toBe("design system");
  await form.getByLabel("None of these words").fill("crypto");
  await form.getByLabel("Minimum Likes").fill("10");
  await form.getByRole("switch", { name: "Replies" }).click();
  // A date counts once Month, Day and Year are all picked.
  for (const [list, option] of [
    ["From month", "March"],
    ["From day", "7"],
    ["From year", "2026"],
  ] as const) {
    await form.getByRole("combobox", { name: list }).click();
    await e.app.getByRole("option", { name: option, exact: true }).click();
  }
  await form.getByRole("button", { name: "Search" }).click();

  const q = "design system -crypto min_faves:10 since:2026-03-07 -filter:replies";
  await expect
    .poll(() => e.mock.reads.filter((r) => r.op === "SearchTimeline").map((r) => r.variables))
    .toContainEqual(expect.objectContaining({ rawQuery: q, product: "Top" }));
  await expect
    .poll(nativeIds)
    .toEqual(e.mock.state.batchFor("SearchTimeline", { product: "Top", rawQuery: q })!.order);
  await expect.poll(() => e.app.getByLabel("Search X").inputValue()).toBe(q);

  // The box shows what the form searched even when that is the search already open: cut the box
  // back, put the same filters back in the form, and the box must say so again.
  await e.app.getByLabel("Search X").fill("design system");
  await e.app.locator("main").getByRole("button", { name: "Advanced search" }).click();
  await form.getByLabel("None of these words").fill("crypto");
  await form.getByLabel("Minimum Likes").fill("10");
  await form.getByRole("switch", { name: "Replies" }).click();
  for (const [list, option] of [
    ["From month", "March"],
    ["From day", "7"],
    ["From year", "2026"],
  ] as const) {
    await form.getByRole("combobox", { name: list }).click();
    await e.app.getByRole("option", { name: option, exact: true }).click();
  }
  await form.getByRole("button", { name: "Search" }).click();
  await expect.poll(() => e.app.getByLabel("Search X").inputValue()).toBe(q);
});

test("Lists, a List's posts and its members read X's pages", async () => {
  await go("/lists");
  const [list] = e.mock.state.lists().filter((l) => l.owner?.userId === e.mock.state.viewer.userId);
  await e.app.locator("main").getByText(list!.name).first().waitFor();
  await go(`/lists/${list!.listId}`);
  const header = e.app.locator('main [data-x="list"]');
  await header.getByText("Members").waitFor();
  expect(await header.innerText()).toContain(list!.name);
  await expect
    .poll(nativeIds)
    .toEqual(e.mock.state.batchFor("ListLatestTweetsTimeline", { listId: list!.listId })!.order);

  await go(`/lists/${list!.listId}/people?of=members`);
  const members = e.mock.state.batchFor("ListMembers", { listId: list!.listId })!;
  await expect
    .poll(nativeHandles)
    .toEqual(members.people.map((id) => members.users.find((u) => u.userId === id)!.handle));
  expect(await enginePath()).toBe(`/i/lists/${list!.listId}/members`);
});

test("Explore, Notifications and Bookmarks render what X sends", async () => {
  await go("/explore");
  const explore = e.mock.state.batchFor("ExplorePage", {})!;
  await e.app.locator("main").getByText(explore.trends[0]!.name).first().waitFor();
  await expect.poll(enginePath).toBe("/explore");

  await go("/notifications");
  const event = e.mock.state
    .batchFor("NotificationsTimeline", { timeline_type: "All" })!
    .notifications.find((n) => n.kind === "event")!;
  await e.app.locator("main").getByText(event.text).first().waitFor();

  await go("/bookmarks");
  await expect.poll(nativeIds).toEqual(e.mock.state.batchFor("Bookmarks", {})!.order);
  await expect.poll(enginePath).toBe("/i/bookmarks");

  // Back on a page X's router already showed: X serves it from its cache and fetches nothing,
  // and Xtend's screen still has its list.
  const before = e.mock.reads.length;
  await go("/explore");
  await expect.poll(enginePath).toBe("/explore");
  await e.app.locator("main").getByText(explore.trends[0]!.name).first().waitFor();
  expect(e.mock.reads.slice(before)).toEqual([]);
});

test("Explore's trend menu lists X's rows, dismisses only that trend, and Undo restores it", async () => {
  await go("/explore");
  const news = e.mock.state.exploreTabs.find((t) => t.id === "news")!;
  await e.app.getByRole("tab", { name: news.label, exact: true }).click();
  await expect.poll(enginePath).toBe("/explore/tabs/news");
  const trends = e.mock.state.batchFor("GenericTimelineById", {
    timelineId: news.timelineId,
  })!.trends;
  const name = trends[1]!.name;
  const row = e.app.locator('main [data-x="trend"]', { hasText: name });
  await row.getByRole("button", { name: "More", exact: true }).click();
  const want = [
    "The associated content is not relevant",
    "This trend is spam",
    "This trend is abusive or harmful",
    "Not interested in this",
    "This trend is a duplicate",
    "This trend is harmful or spammy",
  ];
  await expect.poll(appMenuRows).toEqual(want);
  expect(await engineHas('[data-testid="Dropdown"]')).toBe(false);
  await e.app.getByRole("menuitem", { name: "Not interested in this", exact: true }).click();
  await expect.poll(() => row.count()).toBe(0);
  await expect
    .poll(presses)
    .toEqual(expect.arrayContaining([`press row:Not interested in this trend:${name}`]));
  expect(
    e.mock.state
      .batchFor("GenericTimelineById", { timelineId: news.timelineId })!
      .trends.map((t) => t.name),
  ).toEqual(trends.filter((t) => t.name !== name).map((t) => t.name));
  await e.app.getByRole("button", { name: "Undo", exact: true }).click();
  await row.waitFor();
  expect(await enginePath()).toBe("/explore/tabs/news");
});

test("Explore finds virtualized trends above and below X's scroll for menu reads and presses", async () => {
  await go("/explore");
  const trending = e.mock.state.exploreTabs.find((t) => t.id === "trending")!;
  await e.app.getByRole("tab", { name: trending.label, exact: true }).click();
  await expect.poll(enginePath).toBe("/explore/tabs/trending");
  const trends = e.mock.state.batchFor("GenericTimelineById", {
    timelineId: trending.timelineId,
  })!.trends;
  const name = trends.at(-1)!.name;
  const row = e.app.locator('main [data-x="trend"]', { hasText: name });
  const scroller = e.app.locator("main [data-virtuoso-scroller]").first();
  const engineHasTrend = (name: string) =>
    e.engine<boolean>(
      `[...document.querySelectorAll('[data-testid="trend"]')].some((c) => c.dataset.trend === ${JSON.stringify(name)})`,
    );
  const first = trends[0]!.name;
  await expect.poll(() => engineHasTrend(first)).toBe(true);
  await e.engine('scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })');
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(() => engineHasTrend(first)).toBe(false);
  await e.app
    .locator('main [data-x="trend"]', { hasText: first })
    .getByRole("button", { name: "More", exact: true })
    .click();
  await e.app.getByRole("menuitem", { name: "Not interested in this", exact: true }).waitFor();
  expect(await engineHasTrend(first)).toBe(true);
  await e.app.keyboard.press("Escape");
  await expect
    .poll(async () => {
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      return row.count();
    })
    .toBe(1);
  await row.waitFor();
  await e.engine('scrollTo({ top: 0, behavior: "instant" })');
  await expect.poll(() => engineHasTrend(name)).toBe(false);
  const closed = presses().filter((p) => p === "press menu:closed").length;
  await row.getByRole("button", { name: "More", exact: true }).click();
  await e.app.getByRole("menuitem", { name: "Not interested in this", exact: true }).waitFor();
  await expect.poll(presses).toEqual(expect.arrayContaining([`press menu:trend:${name}`]));
  await expect
    .poll(() => presses().filter((p) => p === "press menu:closed").length)
    .toBe(closed + 1);
  // The press must find it again if X has since virtualized that cell away.
  await e.engine('scrollTo({ top: 0, behavior: "instant" })');
  await expect.poll(() => engineHasTrend(name)).toBe(false);
  await e.app.getByRole("menuitem", { name: "Not interested in this", exact: true }).click();
  await expect.poll(() => row.count()).toBe(0);
  await expect
    .poll(presses)
    .toEqual(expect.arrayContaining([`press row:Not interested in this trend:${name}`]));
  await e.app.getByRole("button", { name: "Undo", exact: true }).click();
  await row.waitFor();
});
