import { Costs_METHODS, Engage_METHODS, WS_METHODS, type FollowUp } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { quoting, settings, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Toasts } from "../ui/toast";
import { SentReplies } from "./Inbox";

const followUp = (id: number, theirs: string, mine: string): FollowUp => {
  const target = xPost(String(1990000000000000000n + BigInt(id)), theirs, {
    author: {
      userId: String(id),
      handle: `author${id}`,
      name: `Author ${id}`,
      followers: 1000,
      verified: false,
      avatarUrl: null,
    },
  });
  return {
    id,
    targetPostId: target.postId,
    targetUrl: target.url,
    targetHandle: target.author.handle,
    text: mine,
    postId: String(1991000000000000000n + BigInt(id)),
    error: null,
    at: "2026-10-20T10:00:00.000Z",
    attributedFollowers: 0,
    target,
  };
};

/** Two due follow-ups; closing one or replying to its post drops it from the next read, as the service does. */
function fakeService(): FakeService {
  const closed = new Set<number>();
  const replied = new Set<string>();
  const all = [
    followUp(1, "timezone bugs again", "we shipped the same thing"),
    followUp(2, "new landing page", "the pricing table answers it"),
  ];
  return {
    [WS_METHODS.settingsGet]: () => Effect.succeed(settings),
    [Costs_METHODS.quote]: quoting(),
    [Engage_METHODS.inbox]: () =>
      Effect.sync(() => ({
        sent: [],
        followUps: all.filter((f) => !closed.has(f.id) && !replied.has(f.targetPostId)),
        incoming: [],
      })),
    [Engage_METHODS.followUpClose]: ({ id, state }) =>
      Effect.sync(() => void (state === null ? closed.delete(id) : closed.add(id))),
    [Engage_METHODS.reply]: ({ post, text }) =>
      Effect.sync(() => {
        replied.add(post.postId);
        return { ...followUp(9, post.text, text), postId: "1992000000000000000" };
      }),
  };
}

const renderFollowUps = () =>
  render(
    <>
      <SentReplies view="followUps" />
      <Toasts />
    </>,
    { service: fakeService() },
  );

it("shows the post followed up on; Done takes it off the due list and Undo puts it back", async () => {
  await using screen = await renderFollowUps();
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("timezone bugs again")).toBeVisible();
  await expect.element(detail.getByText("we shipped the same thing")).toBeVisible();
  await expect.element(screen.getByText("2 due")).toBeVisible();

  await userEvent.click(detail.getByRole("button", { name: "Done" }));
  await expect.element(detail.getByText("new landing page")).toBeVisible();
  await expect.element(screen.getByText("1 due")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await expect.element(screen.getByText("2 due")).toBeVisible();
});

it("a reply in place settles the follow-up", async () => {
  await using screen = await renderFollowUps();
  const detail = screen.getByRole("complementary");
  await expect.element(detail.getByText("timezone bugs again")).toBeVisible();

  await userEvent.fill(detail.getByRole("textbox"), "did you store the zone per slot?");
  await userEvent.click(detail.getByRole("button", { name: /^Reply/ }));

  await expect.element(screen.getByText("Replied to @author1")).toBeVisible();
  await expect.element(screen.getByText("1 due")).toBeVisible();
  await expect.element(detail.getByText("new landing page")).toBeVisible();
});
