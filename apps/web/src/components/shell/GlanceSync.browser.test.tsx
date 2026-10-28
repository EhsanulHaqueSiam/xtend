import type { Draft, Mention, Settings, SpendSummary } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import type { Glance } from "../../desktopBridge";
import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { GlanceSync } from "./GlanceSync";

const settings = {
  handle: "siamships",
  tregTokenSet: true,
  assistBaseUrl: null,
  assistModel: "",
  assistKeySet: false,
  monthlyBudgetUsd: 20,
  sessionPostingEnabled: false,
  dailyLibraryJobs: false,
  voiceNotes: "",
  keywords: [],
  timeZone: "UTC",
} satisfies Settings;

const draft = (id: string, status: Draft["status"], scheduledAt: string | null): Draft => ({
  id,
  kind: "thread",
  status,
  title: "",
  body: "",
  blocks: [{ text: "hello" }],
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  linkPreviewNote: null,
  threadDelaySeconds: 0,
  source: null,
  quoteUrl: null,
  replyToPostId: null,
  articleId: null,
  media: [],
  scheduledAt,
  postIds: [],
  error: null,
  attempts: 0,
  postedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
});

const mention = (postId: string, handled: boolean): Mention => ({
  post: {
    postId,
    url: `https://x.com/a/status/${postId}`,
    text: "@siamships nice",
    createdAt: "2026-10-23T00:00:00.000Z",
    lang: "en",
    isReply: true,
    isRepost: false,
    hasMedia: false,
    hasLink: false,
    author: {
      userId: "1",
      handle: "a",
      name: "A",
      followers: 10,
      verified: false,
      avatarUrl: null,
    },
    metrics: { views: 10, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  },
  source: "session",
  handled,
});

const spend = {
  monthUsd: 1.5,
  todayUsd: 0.21,
  monthlyBudgetUsd: 20,
  byPurpose: [],
  recent: [],
} satisfies SpendSummary;

it("pushes the Today card's glance from queued drafts, slots, open mentions and spend", async () => {
  installFakeBridge();
  const pushed: Array<Glance> = [];
  window.desktopBridge = { ...window.desktopBridge!, pushGlance: (glance) => pushed.push(glance) };

  await using _screen = await render(<GlanceSync />, {
    service: {
      "settings.get": () => Effect.succeed(settings),
      "compose.draftsList": () =>
        Effect.succeed({
          // Only queued drafts count; Monday 7 Jan 2030 09:30 UTC is the earliest of them.
          drafts: [
            draft("d1", "queued", "2030-01-08T10:00:00.000Z"),
            draft("d2", "queued", "2030-01-07T09:30:00.000Z"),
            draft("d3", "draft", null),
          ],
        }),
      // Every day at 09:00: today or tomorrow, depending on when the test runs.
      "plan.slotsGet": () =>
        Effect.succeed({ slots: [{ id: 1, weekdayMask: 127, minuteOfDay: 540 }] }),
      "engage.mentions": () =>
        Effect.succeed({ mentions: [mention("11", false), mention("12", true)], apiError: null }),
      "spend.summary": () => Effect.succeed(spend),
    },
  });

  await expect.poll(() => pushed.at(-1)?.queued).toBe(2);
  expect(pushed.at(-1)).toEqual({
    queued: 2,
    nextScheduled: "Mon 09:30",
    bestTime: expect.stringMatching(/^(Tomorrow )?09:00$/),
    mentions: 1,
    spendTodayUsd: 0.21,
    connected: true,
  });
});
