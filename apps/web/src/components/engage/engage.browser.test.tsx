import type { Mention, ReplyTarget, SentReply, XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { liveEvents, paid, quoting, settings, xPost } from "../../../test/fixtures";
import type { FakeService } from "../../../test/fakeService";
import { fakeTimers, render } from "../../../test/render";
import { Inbox } from "./Mentions";
import { Targets } from "./Targets";

const target = (postId: string, text: string): ReplyTarget => ({
  post: xPost(postId, text),
  keyword: "indie hacking",
  ageMinutes: 12,
  viewsPerHour: 900,
  score: 1,
  reach: "100 to 1k/h",
  replied: false,
  authorScore: null,
  repliesToAuthor: 0,
});

/** What the screens read before anyone clicks: settings with a keyword, and the niche line. */
const screenReads = {
  "settings.get": () =>
    Effect.succeed({ ...settings, dailyLibraryJobs: false, keywords: ["indie hacking"] }),
  "engage.nicheProfile": () => Effect.succeed({ handles: [], topics: [], updatedAt: null }),
  "engage.inbox": () => Effect.succeed({ sent: [], followUps: [], incoming: [] }),
} satisfies FakeService;

it("opening Targets pays for nothing: a paid search waits for the priced click", async () => {
  let searches = 0;
  await using screen = await render(<Targets />, {
    service: {
      ...screenReads,
      // Two keywords, neither in the service's 30-minute cache.
      "costs.quote": quoting((a) => (a.kind === "engageTargets" ? paid(0.0015) : paid(0.001))),
      "engage.targets": () =>
        Effect.sync(() => {
          searches++;
          return [target("1", "Shipping my first SaaS today")];
        }),
    },
  });
  await expect.element(screen.getByText(/^Refresh to search your keywords/)).toBeVisible();
  expect(searches).toBe(0);

  await userEvent.click(screen.getByRole("button", { name: /^Refresh\s*\$0\.0015$/ }));
  await expect
    .element(screen.getByRole("complementary").getByText("Shipping my first SaaS today"))
    .toBeVisible();
  expect(searches).toBe(1);
});

it("shows the cached targets on open when the cache makes them free", async () => {
  let searches = 0;
  await using screen = await render(<Targets />, {
    service: {
      ...screenReads,
      "costs.quote": quoting((a) =>
        a.kind === "engageTargets" ? { usd: 0, cached: true } : paid(0.001),
      ),
      "engage.targets": () =>
        Effect.sync(() => {
          searches++;
          return [target("1", "Shipping my first SaaS today")];
        }),
    },
  });
  await expect
    .element(screen.getByRole("complementary").getByText("Shipping my first SaaS today"))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Refresh\s*cached, free$/ }))
    .toBeVisible();
  expect(searches).toBe(1);
});

it("prices a like with the day's account lookup, and likes on two posts do not cut each other off", async () => {
  const liked: Array<string> = [];
  let releaseFirst = () => {};
  const firstLike = new Promise<void>((resolve) => (releaseFirst = resolve));
  await using screen = await render(<Targets />, {
    service: {
      ...screenReads,
      // The first like of the day also reads the account ($0.015 + $0.01).
      "costs.quote": quoting((a) =>
        a.kind === "like"
          ? paid(0.025)
          : a.kind === "engageTargets"
            ? { usd: 0, cached: true }
            : paid(0.001),
      ),
      "engage.targets": () =>
        Effect.succeed([target("1", "First target"), target("2", "Second target")]),
      "engage.like": ({ postId }) =>
        Effect.gen(function* () {
          // The first like is still in flight when the second post is opened and liked.
          if (postId === "1") yield* Effect.promise(() => firstLike);
          liked.push(postId);
        }),
    },
  });
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("First target")).toBeVisible();

  await userEvent.click(detail.getByRole("button", { name: /^Like\s*\$0\.025$/ }));
  await expect.element(detail.getByRole("button", { name: /^Liking/ })).toBeVisible();
  // Moving on unmounts the first post's reply box; its paid like must keep going.
  await userEvent.click(screen.getByRole("button", { name: /Second target/ }));
  await expect.element(detail.getByText("Second target")).toBeVisible();
  await userEvent.click(detail.getByRole("button", { name: /^Like\s*\$0\.025$/ }));
  await expect.poll(() => liked).toEqual(["2"]);
  releaseFirst();
  await expect.poll(() => liked).toEqual(["2", "1"]);

  // Each post says what its like cost, and a liked post cannot pay for a second one.
  const done = detail.getByRole("button", { name: /^Liked\s*for \$0\.025$/ });
  await expect.element(done).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: /First target/ }));
  await expect.element(detail.getByText("First target")).toBeVisible();
  await expect.element(done).toBeDisabled();
});

it("a paid search still out when the user leaves Engage finishes, and shows on return", async () => {
  let release = () => {};
  const searched = new Promise<void>((resolve) => (release = resolve));
  let searches = 0;
  await using screen = await render(<Targets />, {
    service: {
      ...screenReads,
      "costs.quote": quoting((a) => (a.kind === "engageTargets" ? paid(0.0015) : paid(0.001))),
      "engage.targets": () =>
        Effect.promise(() => searched).pipe(
          Effect.map(() => {
            searches++;
            return [target("1", "Shipping my first SaaS today")];
          }),
        ),
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /^Refresh\s*\$0\.0015$/ }));
  await expect.element(screen.getByRole("button", { name: /^Searching/ })).toBeVisible();
  // Off to another screen while the searches are paid for, then back.
  await screen.rerender(<p>elsewhere</p>);
  release();
  await expect.poll(() => searches).toBe(1);
  await screen.rerender(<Targets />);
  await expect
    .element(screen.getByRole("complementary").getByText("Shipping my first SaaS today"))
    .toBeVisible();
  expect(searches).toBe(1);
});

const mention = (postId: string, handled: boolean): Mention => ({
  post: xPost(postId, `@${settings.handle} love this`),
  source: "api",
  handled,
});

it("says when X refuses the paid mentions read, and marks a mention handled", async () => {
  const handledIds: Array<string> = [];
  await using screen = await render(<Inbox />, {
    service: {
      ...screenReads,
      "costs.quote": quoting(() => paid(0.015)),
      "engage.mentions": ({ refresh }) =>
        Effect.sync(() =>
          refresh === true
            ? { mentions: [], apiError: "X refused the read: 429 Too Many Requests" }
            : { mentions: [mention("7", handledIds.includes("7"))], apiError: null },
        ),
      "engage.mentionHandled": ({ postIds }) => Effect.sync(() => void handledIds.push(...postIds)),
    },
  });
  const open = screen.getByRole("tab", { name: /Open/ });
  await expect.element(open).toHaveTextContent("Open1");

  await userEvent.click(screen.getByRole("button", { name: /^Fetch new\s*\$0\.015$/ }));
  await expect.element(screen.getByText("X refused the read: 429 Too Many Requests")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Mark handled" }));
  await expect.element(screen.getByText("All handled.")).toBeVisible();
  expect(handledIds).toEqual(["7"]);
  // The open count drops with it (a zero count is not drawn).
  await expect.poll(() => open.element().textContent).toBe("Open");
});

/** Targets with two posts, cached so they show on open; a like is $0.025. */
const targetsService = (extra: FakeService = {}): FakeService => ({
  ...screenReads,
  "costs.quote": quoting((a) =>
    a.kind === "engageTargets"
      ? { usd: 0, cached: true }
      : a.kind === "like"
        ? paid(0.025)
        : paid(0.001),
  ),
  "engage.targets": () =>
    Effect.succeed([target("1", "First target"), target("2", "Second target")]),
  ...extra,
});

const sentReply = (post: XPost, text: string): SentReply => ({
  id: 1,
  targetPostId: post.postId,
  targetUrl: post.url,
  targetHandle: post.author.handle,
  text,
  postId: "900",
  error: null,
  at: "2026-10-23T00:00:00.000Z",
  attributedFollowers: 0,
});

it("a reply goes to the post it was written under with what was typed, locked while it goes", async () => {
  const sent: Array<{ readonly post: XPost; readonly text: string }> = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await using screen = await render(<Targets />, {
    service: targetsService({
      "engage.reply": (input) =>
        Effect.promise(() => {
          sent.push(input);
          return held;
        }).pipe(Effect.as(sentReply(input.post, input.text))),
    }),
  });
  const detail = screen.getByRole("complementary");
  await userEvent.click(screen.getByRole("button", { name: /Second target/ }));
  await expect.element(detail.getByText("Second target")).toBeVisible();
  const editor = detail.getByRole("textbox");
  await userEvent.fill(editor, "price per seat, not per call");
  await userEvent.click(detail.getByRole("button", { name: /^Reply\s*\$0\.015$/ }));
  await expect.element(editor).toBeDisabled();
  release();
  await expect.element(detail.getByRole("button", { name: /^Replied/ })).toBeVisible();
  expect(sent).toEqual([
    { post: xPost("2", "Second target"), text: "price per seat, not per call" },
  ]);
});

it("a like in flight cannot be paid for twice", async () => {
  let likes = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await using screen = await render(<Targets />, {
    service: targetsService({
      "engage.like": () =>
        Effect.promise(() => {
          likes++;
          return held;
        }),
    }),
  });
  const detail = screen.getByRole("complementary");
  const like = detail.getByRole("button", { name: /^(Like|Liking)/ });
  await userEvent.click(like);
  await expect.element(like).toBeDisabled();
  // A click straight on the element skips the wait for it to be enabled.
  like.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  release();
  await expect.element(detail.getByRole("button", { name: /^Liked/ })).toBeVisible();
  expect(likes).toBe(1);
});

it("each post keeps its own reply while the user moves between them", async () => {
  await using screen = await render(<Targets />, {
    service: targetsService({ "engage.like": () => Effect.void }),
  });
  const detail = screen.getByRole("complementary");
  const editor = detail.getByRole("textbox");
  await expect.element(detail.getByText("First target")).toBeVisible();
  await userEvent.fill(editor, "reply one");
  await userEvent.click(screen.getByRole("button", { name: /Second target/ }));
  await expect.element(editor).toHaveValue("");
  await userEvent.fill(editor, "reply two");
  // A like changes this post's work too; the text rides along.
  await userEvent.click(detail.getByRole("button", { name: /^Like\s/ }));
  await expect.element(detail.getByRole("button", { name: /^Liked/ })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /First target/ }));
  await expect.element(editor).toHaveValue("reply one");
  await userEvent.click(screen.getByRole("button", { name: /Second target/ }));
  await expect.element(editor).toHaveValue("reply two");
});

it("j and k typed into a reply stay in the reply", async () => {
  await using screen = await render(<Targets />, { service: targetsService() });
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("First target")).toBeVisible();
  const editor = detail.getByRole("textbox");
  await userEvent.type(editor, "jkj");
  await expect.element(editor).toHaveValue("jkj");
  await expect.element(detail.getByText("First target")).toBeVisible();
});

it("with session actions on, a reply says it goes free through the session, in any client", async () => {
  await using screen = await render(<Targets />, {
    service: targetsService({
      "settings.get": () =>
        Effect.succeed({ ...settings, keywords: ["indie hacking"], sessionPostingEnabled: true }),
    }),
  });
  const detail = screen.getByRole("complementary");
  await userEvent.fill(detail.getByRole("textbox"), "hello");
  await expect
    .element(detail.getByRole("button", { name: /^Reply\s*free · your session$/ }))
    .toBeEnabled();
});

it("paid fetches wait for their price", async () => {
  {
    await using screen = await render(<Targets />, {
      service: { ...screenReads, "costs.quote": () => Effect.never },
    });
    await expect.element(screen.getByRole("button", { name: /^Refresh/ })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: /^Find keywords/ })).toBeDisabled();
  }
  await using screen = await render(<Inbox />, {
    service: {
      ...screenReads,
      "costs.quote": () => Effect.never,
      "engage.mentions": () => Effect.succeed({ mentions: [], apiError: null }),
    },
  });
  await expect.element(screen.getByRole("button", { name: /^Fetch new/ })).toBeDisabled();
});

it("the inbox follows what the session sees, one refetch for a burst of batches", async () => {
  // The burst's refetch waits out a 1 s debounce; the clock moves on its own and can be jumped.
  using _timers = fakeTimers({ shouldAdvanceTime: true });
  const events = liveEvents();
  let reads = 0;
  await using screen = await render(<Inbox />, {
    service: {
      ...screenReads,
      "costs.quote": quoting(),
      "events.subscribe": events.subscribe,
      "engage.mentions": () => Effect.succeed({ mentions: [], apiError: null }),
      "engage.inbox": () =>
        Effect.sync(() => {
          reads++;
          return { sent: [], followUps: [], incoming: reads === 1 ? [] : [mention("8", false)] };
        }),
    },
  });
  await expect.element(screen.getByText(/^Nothing yet/)).toBeVisible();
  for (let i = 0; i < 3; i++) events.emit("observation_recorded", { posts: 4, source: "home" });
  await expect
    .element(screen.getByRole("complementary").getByText(`@${settings.handle} love this`))
    .toBeVisible();
  // Past any later debounce: the burst made one refetch, not one per batch.
  await vi.advanceTimersByTimeAsync(1500);
  expect(reads).toBe(2);
});

it("lists a reply that also names you once, as a reply", async () => {
  const reply = { ...mention("8", false), post: { ...mention("8", false).post, isReply: true } };
  await using screen = await render(<Inbox />, {
    service: {
      ...screenReads,
      "costs.quote": quoting(),
      "engage.mentions": () =>
        Effect.succeed({ mentions: [mention("8", false), mention("9", false)], apiError: null }),
      "engage.inbox": () => Effect.succeed({ sent: [], followUps: [], incoming: [reply] }),
    },
  });
  await expect.element(screen.getByRole("tab", { name: /Open/ })).toHaveTextContent("Open2");
  await expect.element(screen.getByText(/· reply/).first()).toBeVisible();
  await expect.element(screen.getByText(/· mention/).first()).toBeVisible();
});
