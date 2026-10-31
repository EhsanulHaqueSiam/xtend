import type { EnginePost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { EngineSync } from "./EngineSync";
import { ReplyComposer } from "./ReplyComposer";
import { Timeline } from "./Timeline";

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
  trends: [],
  notifications: [],
  lists: [],
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
      post("2", "Day 31/ side chats https://t.co/abc", {
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
  // X's trailing media link is X's own plumbing; it never shows.
  await expect.element(first.getByText("Day 31/ side chats", { exact: true })).toBeVisible();
  await expect.element(first.getByText("Day 30/ panels")).toBeVisible();
  const video = first.element().querySelector("video")!;
  expect(video.getAttribute("src")).toBe("https://video.twimg.com/high.mp4");
  expect(video.controls).toBe(true);
  // The quoted post is inside the first, not a row of its own.
  expect(screen.getByRole("article").elements()).toHaveLength(1);
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
      post(
        "7",
        "same here https://t.co/abc @rauchg #buildinpublic costs $5,000 https://t.co/card",
        {
          context: { type: "Retweet", text: "Guillermo reposted", handle: "rauchg" },
          replyingTo: ["levelsio"],
          links: [
            {
              url: "https://t.co/abc",
              expanded: "https://x.com/rauchg/status/9",
              display: "x.com/rauchg/st…",
            },
          ],
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
        },
      ),
    ]),
  );
  const row = screen.getByRole("article").first();
  await expect.element(row.getByText("Guillermo reposted")).toBeVisible();
  await expect.element(row.getByText(/^Replying to @levelsio$/)).toBeVisible();
  // X shows a link's short form; the card's own t.co link never shows.
  await expect.element(row.getByRole("link", { name: "x.com/rauchg/st…" })).toBeVisible();
  expect(row.element().textContent).not.toContain("t.co/card");
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
});
