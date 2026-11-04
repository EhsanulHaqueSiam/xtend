import { type EngineBatch, type EngineUser, ScoresError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { CaseRow, RequestRow } from "./CommunityQueues";
import { EngineSync } from "./EngineSync";

const asker: EngineUser = {
  userId: "31",
  handle: "priyabuilds",
  name: "Priya Nair",
  avatarUrl: null,
  bannerUrl: null,
  bio: "Invoicing for freelancers.",
  location: null,
  website: null,
  joinedAt: "2019-03-01T00:00:00.000Z",
  followers: 2100,
  following: 300,
  posts: 900,
  verified: false,
  isProtected: false,
  youFollow: false,
  followsYou: true,
  pinnedPostId: null,
  verifiedType: null,
  avatarShape: "Circle",
  affiliate: null,
};

const empty = (op: string, extra: Partial<EngineBatch>): EngineBatch => ({
  op,
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
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
  ...extra,
});

it("draws a request with X's line and Xtend's own, then X's words once X approved it", async () => {
  const bridge = installFakeBridge();
  await using screen = await render(
    <>
      <EngineSync />
      <RequestRow
        communityId="20"
        request={{
          userId: "31",
          answer: "An invoicing tool that chases late payers.",
          at: "2026-11-03T12:00:00.000Z",
          state: "Pending",
          blocking: true,
          muting: false,
        }}
      />
    </>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        "scores.report": () =>
          Effect.fail(new ScoresError({ operation: "report", detail: "none" })),
        "leads.peopleList": () =>
          Effect.succeed({
            people: [
              {
                id: 1,
                handle: "priyabuilds",
                name: "Priya Nair",
                userId: "31",
                followers: 2100,
                bio: "",
                stage: "contacted" as const,
                notes: "",
                score: 74,
                tier: null,
                source: "manual",
                firstSeen: "2026-10-01T00:00:00.000Z",
                lastActivity: "2026-10-01T00:00:00.000Z",
              },
            ],
            total: 1,
            counts: { new: 0, contacted: 1, replied: 0, customer: 0, ignored: 0 },
            offset: 0,
          }),
      },
    },
  );
  bridge.emitEngine(empty("MemberRequests_Query", { users: [asker] }));
  await expect.element(screen.getByText("Follows you")).toBeVisible();
  await expect.element(screen.getByText(/You’ve blocked this person/)).toBeVisible();
  // Xtend's line: the Leads score, followers, account age and the Leads stage.
  await expect
    .element(screen.getByText(/score 74 · 2.1K followers · since 2019 · Lead ·/))
    .toBeVisible();
  await expect.element(screen.getByText("contacted")).toBeVisible();
  // X approved them: the row is X's words now.
  await screen.rerender(
    <>
      <EngineSync />
      <RequestRow
        communityId="20"
        request={{
          userId: "31",
          answer: null,
          at: null,
          state: "Approved",
          blocking: false,
          muting: false,
        }}
      />
    </>,
  );
  await expect
    .element(screen.getByText("@priyabuilds was approved and is now a member of your Community"))
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Approve" }).query()).toBeNull();
});

it("says who reported a post as X does, X itself among them", async () => {
  const bridge = installFakeBridge();
  const kase = (reports: number, byX: boolean) => ({
    postId: "50",
    reports,
    at: null,
    byX,
    rules: ["No spam", "No spam"],
  });
  await using screen = await render(
    <>
      <EngineSync />
      <CaseRow communityId="20" kase={kase(3, true)} />
      <CaseRow communityId="20" kase={kase(1, true)} />
      <CaseRow communityId="20" kase={kase(1, false)} />
    </>,
  );
  bridge.emitEngine(
    empty("CommunityModerationTweetCasesSlice", {
      posts: [
        {
          postId: "50",
          author: { userId: "1", handle: "ray", name: "Ray", followers: 9, verified: false },
          text: "Anyone watching the game tonight?",
          createdAt: "2026-11-03T08:00:00.000Z",
          isReply: false,
          isRepost: false,
          isPromoted: false,
          hasMedia: false,
          hasLink: false,
          metrics: { views: 9, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
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
        },
      ],
    }),
  );
  await expect.element(screen.getByText("Reported by @X and 2 members")).toBeVisible();
  await expect.element(screen.getByText("Reported by @X", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Reported by 1 member", { exact: true })).toBeVisible();
  // Each rule once, as the reports named it.
  expect(screen.getByText("· No spam", { exact: false }).all()).toHaveLength(3);
});
