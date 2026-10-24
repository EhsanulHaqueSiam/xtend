import type { Mention, ReplyTarget } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { paid, quoting, settings, xPost } from "../../../test/fixtures";
import type { FakeService } from "../../../test/fakeService";
import { render } from "../../../test/render";
import { EngageScreen } from "../../routes/engage";

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

/** What the screen reads before anyone clicks: the niche line and the header's mention count. */
const screenReads = {
  "engage.nicheProfile": () => Effect.succeed({ handles: [], topics: [], updatedAt: null }),
  "engage.mentions": () => Effect.succeed({ mentions: [], apiError: null }),
} satisfies FakeService;

it("opening Targets pays for nothing: a paid search waits for the priced click", async () => {
  let searches = 0;
  await using screen = await render(<EngageScreen />, {
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
  await expect.element(screen.getByText(/^Refresh targets to search your keywords/)).toBeVisible();
  expect(searches).toBe(0);

  await userEvent.click(screen.getByRole("button", { name: "Refresh targets ($0.0015)" }));
  await expect.element(screen.getByText("Shipping my first SaaS today")).toBeVisible();
  expect(searches).toBe(1);
});

it("shows the cached targets on open when the cache makes them free", async () => {
  let searches = 0;
  await using screen = await render(<EngageScreen />, {
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
  await expect.element(screen.getByText("Shipping my first SaaS today")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Refresh targets (cached, free)" }))
    .toBeVisible();
  expect(searches).toBe(1);
});

it("prices a like with the day's account lookup, and likes on two rows do not cut each other off", async () => {
  const liked: Array<string> = [];
  let releaseFirst = () => {};
  const firstLike = new Promise<void>((resolve) => (releaseFirst = resolve));
  await using screen = await render(<EngageScreen />, {
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
          // The first like is still in flight when the second row is clicked.
          if (postId === "1") yield* Effect.promise(() => firstLike);
          liked.push(postId);
        }),
    },
  });
  await expect.element(screen.getByText("Second target")).toBeVisible();
  const likes = screen.getByRole("button", { name: "Like · $0.025" });
  await expect.poll(() => likes.elements().length).toBe(2);

  await userEvent.click(likes.nth(0));
  await expect.element(screen.getByRole("button", { name: "Liking…" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Like · $0.025" }));
  await expect.poll(() => liked).toEqual(["2"]);
  releaseFirst();
  await expect.poll(() => liked).toEqual(["2", "1"]);

  // Each row says what its like cost, and a liked row cannot pay for a second one.
  const done = screen.getByRole("button", { name: "Liked" });
  await expect.poll(() => done.elements().length).toBe(2);
  for (const button of done.elements()) expect(button).toBeDisabled();
  await expect.poll(() => screen.getByText("Liked for $0.025").elements().length).toBe(2);
});

it("a paid search still out when the user leaves Engage finishes, and shows on return", async () => {
  let release = () => {};
  const searched = new Promise<void>((resolve) => (release = resolve));
  let searches = 0;
  await using screen = await render(<EngageScreen />, {
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
  await userEvent.click(screen.getByRole("button", { name: "Refresh targets ($0.0015)" }));
  await expect.element(screen.getByRole("button", { name: "Searching…" })).toBeVisible();
  // Off to another screen while the searches are paid for, then back.
  await screen.rerender(<p>elsewhere</p>);
  release();
  await expect.poll(() => searches).toBe(1);
  await screen.rerender(<EngageScreen />);
  await expect.element(screen.getByText("Shipping my first SaaS today")).toBeVisible();
  expect(searches).toBe(1);
});

const mention = (postId: string, handled: boolean): Mention => ({
  post: xPost(postId, `@${settings.handle} love this`),
  source: "api",
  handled,
});

it("says when X refuses the paid mentions read, and marks a mention handled", async () => {
  const handledIds: Array<string> = [];
  await using screen = await render(<EngageScreen />, {
    service: {
      ...screenReads,
      "costs.quote": quoting(() => paid(0.015)),
      "engage.mentions": ({ refresh }) =>
        Effect.sync(() =>
          refresh === true
            ? { mentions: [], apiError: "X refused the read: 429 Too Many Requests" }
            : { mentions: [mention("7", handledIds.includes("7"))], apiError: null },
        ),
      "engage.mentionHandled": ({ postId }) => Effect.sync(() => void handledIds.push(postId)),
    },
  });
  await expect.element(screen.getByText("1 unhandled mentions")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Mentions" }));

  await userEvent.click(screen.getByRole("button", { name: "Fetch new mentions ($0.015)" }));
  await expect.element(screen.getByText("X refused the read: 429 Too Many Requests")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Mark handled" }));
  await expect.element(screen.getByText("handled", { exact: true })).toBeVisible();
  expect(handledIds).toEqual(["7"]);
  await expect.element(screen.getByText("0 unhandled mentions")).toBeVisible();
});
