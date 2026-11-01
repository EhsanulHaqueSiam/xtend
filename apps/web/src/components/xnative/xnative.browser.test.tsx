import type { DraftPatch, EnginePost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { draft, settings } from "../../../test/fixtures";
import { fakeTimers, render } from "../../../test/render";
import { markXReady, refreshScreen, registerXWebview, type XWebview } from "../../state/x";
import { CommunityHeader } from "./CommunityHeader";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";
import { Poll } from "./PostParts";
import { ReplyComposer } from "./ReplyComposer";
import { ReplySort } from "./ReplySort";
import { Timeline } from "./Timeline";
import { Suspense } from "react";
import { Route as ListsRoute } from "../../routes/lists.index";

// Polls count their days left from now; these tests run at this moment.
const NOW = Date.parse("2026-10-31T12:00:00.000Z");

const post = (postId: string, text: string, extra: Partial<EnginePost> = {}): EnginePost => ({
  postId,
  author: { userId: "1", handle: "theo", name: "Theo", followers: 300000, verified: true },
  text,
  createdAt: "2026-10-31T08:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 9900, likes: 120, reposts: 4, replies: 12, quotes: 1, bookmarks: 3 },
  avatarUrl: null,
  media: [],
  quotedId: null,
  replyToId: null,
  replyingTo: [],
  entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
  card: null,
  poll: null,
  note: null,
  context: null,
  liked: false,
  reposted: false,
  bookmarked: false,
  conversation: null,
  edits: [],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
  ...extra,
});

/** One response as the desktop's capture sends it, with nothing but posts. */
const batch = (op: string, posts: ReadonlyArray<EnginePost>) => ({
  op,
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts,
  users: [],
  people: [],
  sections: [],
  order: [],
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
});

it("draws what the engine received: the post, its video in Xtend's player, and the post it quotes", async () => {
  const bridge = installFakeBridge();
  await using screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <Timeline surface="following" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    { service: {} },
  );
  bridge.emitEngine(
    batch("HomeLatestTimeline", [
      // The capture hands over the text X shows: its trailing media link already gone.
      post("2", "Day 31/ side chats", {
        quotedId: "1",
        media: [
          {
            kind: "video",
            url: "https://pbs.twimg.com/poster.jpg",
            videoUrl: "https://video.twimg.com/high.mp4",
            width: 1280,
            height: 720,
            durationMs: 24866,
            altText: null,
          },
        ],
      }),
      post("1", "Day 30/ panels"),
    ]),
  );
  const first = screen.getByRole("article").first();
  await expect.element(first.getByText("Day 31/ side chats", { exact: true })).toBeVisible();
  await expect.element(first.getByText("Day 30/ panels")).toBeVisible();
  const video = first.element().querySelector("video")!;
  expect(video.getAttribute("src")).toBe("https://video.twimg.com/high.mp4");
  expect(video.controls).toBe(true);
  // The quoted post is inside the first, not a row of its own.
  expect(screen.getByRole("article").elements()).toHaveLength(1);
});

it("draws X's Who to follow between the posts X put it between: three people with Follow, and Show more", async () => {
  const bridge = installFakeBridge();
  await using screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <Timeline surface="forYou" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    { service: {} },
  );
  // The module and people of the dev fixture `?engine=home`, between two short posts so the
  // virtualized list draws all three whatever the layout.
  const forYou = synth().home!.batches.find((b) => b.op === "HomeTimeline")!;
  const wtf = forYou.modules[0]!;
  bridge.emitEngine({
    ...batch("HomeTimeline", [post("1", "First"), post("2", "Second")]),
    users: forYou.users,
    order: ["1", wtf.id, "2"],
    modules: [wtf],
  });
  const module = screen.getByRole("region", { name: "Who to follow" });
  await expect.element(module).toBeVisible();
  expect(module.getByRole("button", { name: "Follow", exact: true }).elements()).toHaveLength(3);
  await expect
    .element(module.getByRole("link", { name: "Show more" }))
    .toHaveAttribute("href", "/follow?tab=who");
  // Second in the list, after post 1, however many rows the virtualized list has drawn.
  const index = (el: Element) => el.closest("[data-index]")?.getAttribute("data-index");
  expect(index(module.element())).toBe("1");
  expect(index(screen.getByRole("article").first().element())).toBe("0");
});

it("reads the post before replying, rereads on a correction, and sends the picked angle", async () => {
  const reads: Array<string | undefined> = [];
  const sent: Array<string> = [];
  await using screen = await render(
    <ReplyComposer
      post={post("7", "I caved.", {
        media: [
          {
            kind: "photo",
            url: "https://pbs.twimg.com/a.jpg",
            videoUrl: null,
            width: 1,
            height: 1,
            durationMs: null,
            altText: null,
          },
        ],
      })}
      thread={[]}
      onSent={() => {}}
    />,
    {
      service: {
        "engage.readPost": ({ images, correction }) =>
          Effect.sync(() => {
            reads.push(correction);
            expect(images).toEqual(["https://pbs.twimg.com/a.jpg"]);
            return {
              read: correction ?? "Reluctant feature drop",
              signals: ['"I caved"'],
              angles: [
                { label: "Play along with the caving", text: "day 31 and the users are winning" },
              ],
              why: "he jokes about it",
            };
          }),
        "engage.reply": ({ text }) =>
          Effect.sync(() => {
            sent.push(text);
            return {
              id: 1,
              postId: "8",
              inReplyTo: "7",
              text,
              at: "2026-10-31T08:01:00.000Z",
              error: null,
              attributedFollowers: 0,
              targetAuthor: "theo",
              targetText: "I caved.",
            } as never;
          }),
      },
    },
  );
  await expect.element(screen.getByText("Reluctant feature drop")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Sarcastic" }));
  await expect.element(screen.getByText("Sarcastic", { exact: true }).first()).toBeVisible();
  expect(reads).toEqual([undefined, "Sarcastic"]);

  await userEvent.click(screen.getByRole("button", { name: /Play along with the caving/ }));
  await expect
    .element(screen.getByLabelText("Your reply"))
    .toHaveValue("day 31 and the users are winning");
  await userEvent.click(screen.getByRole("button", { name: /^Reply/ }));
  await expect.poll(() => sent).toEqual(["day 31 and the users are winning"]);
});

it("draws what X draws around a post: its context line, live text, card, poll, note and the viewer's own like", async () => {
  const TEXT = "same here https://t.co/abc @rauchg #buildinpublic costs $5,000";
  const span = (part: string) => [TEXT.indexOf(part), TEXT.indexOf(part) + part.length] as const;
  const bridge = installFakeBridge();
  await using screen = await render(
    <div style={{ height: 1200, display: "flex" }}>
      <EngineSync />
      <Timeline surface="search" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    { service: {} },
  );
  bridge.emitEngine(
    // Its own surface: the store outlives a test, and Following already holds the first test's posts.
    batch("SearchTimeline", [
      post("7", TEXT, {
        context: { type: "Retweet", text: "Guillermo reposted", handle: "rauchg" },
        replyingTo: ["levelsio"],
        // Where X's entities sit in the shown text; the card's link is drawn as the card (no
        // indices), and the price has none, as on X.
        entities: {
          urls: [
            {
              url: "https://t.co/abc",
              expanded: "https://x.com/rauchg/status/9",
              display: "x.com/rauchg/st…",
              indices: span("https://t.co/abc"),
            },
            {
              url: "https://t.co/card",
              expanded: "https://levels.io/vps",
              display: "levels.io/vps",
              indices: null,
            },
          ],
          mentions: [{ handle: "rauchg", indices: span("@rauchg") }],
          hashtags: [{ tag: "buildinpublic", indices: span("#buildinpublic") }],
          cashtags: [],
        },
        card: {
          kind: "link",
          url: "https://levels.io/vps",
          title: "One VPS",
          domain: "levels.io",
          description: null,
          imageUrl: null,
        },
        poll: {
          choices: [
            { label: "Yes", votes: 58 },
            { label: "No", votes: 42 },
          ],
          endsAt: null,
          final: true,
          voted: null,
        },
        note: "The bench measures one task set.",
        liked: true,
        aiGenerated: true,
      }),
    ]),
  );
  const row = screen.getByRole("article").first();
  await expect.element(row.getByText("Guillermo reposted")).toBeVisible();
  await expect.element(row.getByText(/^Replying to @levelsio$/)).toBeVisible();
  // X shows a link's short form in place of its t.co.
  await expect.element(row.getByRole("link", { name: "x.com/rauchg/st…" })).toBeVisible();
  expect(row.element().textContent).not.toContain("t.co");
  await expect.element(row.getByRole("link", { name: "@rauchg" })).toBeVisible();
  await expect.element(row.getByRole("link", { name: "#buildinpublic" })).toBeVisible();
  // A price is not a cashtag.
  expect(row.getByRole("link", { name: "$5" }).elements()).toHaveLength(0);
  await expect.element(row.getByText("One VPS")).toBeVisible();
  await expect.element(row.getByText("58%")).toBeVisible();
  await expect.element(row.getByText("Readers added context")).toBeVisible();
  // Liked on X already: the button shows it, and the count is X's, not one more.
  await expect
    .element(row.getByRole("button", { name: "Like" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(row.getByRole("button", { name: "Like" })).toHaveTextContent("120");
  // X counts quotes with reposts (4 + 1), and labels AI-made posts.
  await expect.element(row.getByRole("button", { name: "Repost" })).toHaveTextContent("5");
  await expect.element(row.getByText("Made with AI")).toBeVisible();
});

it("opens X's Repost / Quote popover, and Quote posts the comment over the quoted link through the session", async () => {
  const bridge = installFakeBridge();
  const creates: Array<DraftPatch> = [];
  await using screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <Timeline surface="bookmarks" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        "compose.draftCreate": (patch) =>
          Effect.sync(() => {
            creates.push(patch);
            return draft("q1", "draft");
          }),
        "compose.postNow": ({ id }) => Effect.succeed(draft(id, "posted", { postIds: ["99"] })),
      },
    },
  );
  bridge.emitEngine(batch("Bookmarks", [post("40", "Ship the quote box")]));
  const row = screen.getByRole("article").first();
  // By keyboard throughout: Enter on the button and on the row is theirs, not the list's
  // "open the post".
  const repost = row.getByRole("button", { name: "Repost" });
  await expect.element(repost).toBeVisible();
  (repost.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("menuitem", { name: "Repost" })).toBeVisible();
  (page.getByRole("menuitem", { name: "Quote" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");

  // The column's quote box opens over it, in a portal outside the rendered tree.
  const box = page.getByRole("dialog", { name: "Quote" });
  await expect.element(box.getByText("Ship the quote box")).toBeVisible();
  expect(screen.router?.state.location.pathname).toBe("/");
  await userEvent.fill(box.getByLabelText("Your comment"), "this is the way");
  await expect.element(box.getByRole("button", { name: "Post" })).toBeEnabled();
  // Tests load no CSS, so Base UI's backdrop covers the unstyled box: post by X's shortcut.
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  await expect
    .poll(() => creates)
    .toEqual([{ blocks: [{ text: "this is the way" }], quoteUrl: "https://x.com/theo/status/40" }]);
  await expect.element(box).not.toBeInTheDocument();
});

it("votes in an open poll through X's own radio, then shows the results with the vote counted", async () => {
  using _clock = fakeTimers({ now: NOW, shouldAdvanceTime: true });
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  // The engine: X takes the vote and draws its results.
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
  } as unknown as XWebview);
  markXReady();
  try {
    await using screen = await render(
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <Timeline surface="likes" header={null} empty="Loading" onReopen={() => {}} />
      </div>,
      {
        service: {
          "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        },
      },
    );
    bridge.emitEngine(
      batch("Likes", [
        post("50", "Tabs or spaces?", {
          poll: {
            choices: [
              { label: "Tabs", votes: 58 },
              { label: "Spaces", votes: 41 },
            ],
            endsAt: new Date(NOW + 49 * 3_600_000).toISOString(),
            final: false,
            voted: null,
          },
        }),
      ]),
    );
    const row = screen.getByRole("article").first();
    // Open and not voted: X's choices, no counts yet.
    await expect.element(row.getByText("100 votes", { exact: false })).not.toBeInTheDocument();
    await expect.element(row.getByText("99 votes · 2 days left")).toBeVisible();
    await row.getByRole("radio", { name: "Spaces" }).click();
    await expect.element(row.getByText("Spaces ✓")).toBeVisible();
    await expect.element(row.getByText("100 votes · 2 days left")).toBeVisible();
    await expect.element(row.getByText("42%")).toBeVisible();
    expect(scripts.some((s) => s.includes('"Spaces"') && s.includes("cardPoll"))).toBe(true);
    // The vote stayed on the list, not the post's own page.
    expect(screen.router?.state.location.pathname).toBe("/");
  } finally {
    registerXWebview(null);
  }
});

it("keeps a vote X took when the poll is drawn again, as a list does after scrolling", async () => {
  using _clock = fakeTimers({ now: NOW, shouldAdvanceTime: true });
  const poll = {
    choices: [
      { label: "Tabs", votes: 1 },
      { label: "Spaces", votes: 0 },
    ],
    endsAt: new Date(NOW + 49 * 3_600_000).toISOString(),
    final: false,
    voted: null,
  };
  const vote = () => Promise.resolve(true);
  await using screen = await render(<Poll key="a" postId="51" poll={poll} onVote={vote} />, {
    service: {},
  });
  await screen.getByRole("radio", { name: "Spaces" }).click();
  await expect.element(screen.getByText("Spaces ✓")).toBeVisible();
  // Every poll scrolled out of the virtualized list, long enough for unused state to go...
  await screen.rerender(<p>Elsewhere in the list</p>);
  await vi.advanceTimersByTimeAsync(200);
  // ...then the row scrolled back in, a new Poll.
  await screen.rerender(<Poll key="b" postId="51" poll={poll} onVote={vote} />);
  await expect.element(screen.getByText("Spaces ✓")).toBeVisible();
  expect(screen.getByRole("radio").elements()).toHaveLength(0);
});

it("sorts replies through X's own menu: Relevant, Recent, Likes, the open one checked", async () => {
  const picked: Array<string> = [];
  await using screen = await render(
    <ReplySort value="Relevance" onChange={(sort) => picked.push(sort)} />,
    { service: {} },
  );
  await screen.getByRole("button", { name: "Relevant" }).click();
  await expect.element(screen.getByText("Sort replies")).toBeVisible();
  const rows = screen.getByRole("menuitem");
  expect(rows.elements().map((r) => r.textContent)).toEqual(["Relevant", "Recent", "Likes"]);
  expect(rows.first().element().querySelector("svg")).not.toBeNull();
  await screen.getByRole("menuitem", { name: "Recent" }).click();
  expect(picked).toEqual(["Recency"]);
  await screen.rerender(<ReplySort value="Recency" onChange={() => {}} />);
  await expect.element(screen.getByRole("button", { name: "Recent" })).toBeVisible();
});

it("keeps a follow X took from its own post menu, as X's menu says afterwards", async () => {
  const bridge = installFakeBridge();
  // The engine: X's menu rows, and what pressing a row turns them into (X's own state).
  let rows = ["Follow @theo"];
  let afterPress = ["Unfollow @theo"];
  let pressed: unknown = { kind: "done", toast: null, undo: false };
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      if (code.includes("const labels")) return Promise.resolve(rows);
      if (!code.includes("item.click()")) return Promise.resolve(false);
      rows = afterPress;
      return Promise.resolve(pressed);
    },
  } as unknown as XWebview);
  markXReady();
  const asked = () =>
    (Reflect.get(window, "__xtendEngine") as () => { asked: ReadonlyMap<string, boolean> })().asked;
  const press = async (label: string) => {
    await row().getByRole("button", { name: "More" }).click();
    await screenRef!.getByRole("menuitem", { name: label }).click();
  };
  let screenRef: Awaited<ReturnType<typeof render>> | undefined;
  const row = () => screenRef!.getByRole("article").first();
  try {
    await using screen = await render(
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <Timeline surface="likes" header={null} empty="Loading" onReopen={() => {}} />
      </div>,
      {
        service: {
          "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        },
      },
    );
    screenRef = screen;
    bridge.emitEngine(batch("Likes", [post("60", "Shipping today")]));
    await press("Follow @theo");
    await expect.poll(() => asked().get("1")).toBe(true);

    // Unfollow asks in X's dialog; the user cancels, and X's menu still says Unfollow.
    afterPress = ["Unfollow @theo"];
    pressed = { kind: "over", path: "/home" };
    await press("Unfollow @theo");
    await expect.poll(() => asked().get("1"), { timeout: 5000 }).toBe(true);

    // X refuses an Unfollow without a dialog: its menu still says Unfollow, so nothing changes;
    // then it takes one, and its menu says Follow.
    pressed = { kind: "done", toast: "Something went wrong", undo: false };
    await press("Unfollow @theo");
    rows = ["Unfollow @theo"];
    afterPress = ["Follow @theo"];
    pressed = { kind: "done", toast: null, undo: false };
    await press("Unfollow @theo");
    await expect.poll(() => asked().get("1")).toBe(false);
  } finally {
    registerXWebview(null);
  }
});

it("opens X's Lists page of the account X is signed in to, not the one Settings names, once X names it", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/home",
    loadURL: (url: string) => (scripts.push(url), Promise.resolve()),
  } as unknown as XWebview);
  markXReady();
  try {
    const Lists = ListsRoute.options.component!;
    await using screen = await render(
      <>
        <EngineSync />
        <Suspense>
          <Lists />
        </Suspense>
      </>,
      {
        service: { "settings.get": () => Effect.succeed({ ...settings, handle: "someone_else" }) },
      },
    );
    // X's first load named no account: ⌘R loads Home, which names it, then the Lists open.
    await expect.element(screen.getByText("Loading your Lists from X.")).toBeVisible();
    refreshScreen();
    expect(scripts).toEqual(["https://x.com/home"]);
    bridge.emitEngine({
      ...batch("Viewer", []),
      viewer: { userId: "7", handle: "me", name: "Me", avatarUrl: null },
    });
    await expect.poll(() => scripts.some((s) => s.includes('"/me/lists"'))).toBe(true);
    expect(scripts.some((s) => s.includes("someone_else"))).toBe(false);
  } finally {
    registerXWebview(null);
  }
});

it("runs one of a Community header's presses at a time: Join waits while X takes Pin", async () => {
  // X's page holds the Pin press until the test lets it finish.
  let finish: (done: unknown) => void = () => {};
  registerXWebview({
    getURL: () => "https://x.com/i/communities/20",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) =>
      code.includes("button.click()")
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve(true),
  } as unknown as XWebview);
  markXReady();
  try {
    await using screen = await render(
      <CommunityHeader
        community={{
          communityId: "20",
          name: "C20",
          description: null,
          bannerUrl: null,
          members: 9,
          topic: null,
          rules: null,
          joinPolicy: "Open",
          role: "NonMember",
        }}
      />,
      {
        service: {
          "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        },
      },
    );
    const join = screen.getByRole("button", { name: "Join C20" });
    await screen.getByRole("button", { name: "Pin Community" }).click();
    await expect.element(join).toBeDisabled();
    finish({ over: null, toast: null, label: "Unpin" });
    await expect.element(join).toBeEnabled();
  } finally {
    registerXWebview(null);
  }
});
