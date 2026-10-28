import type {
  CostAction,
  CostQuote,
  Draft,
  RateCard,
  Settings,
  XPost,
  XtendEvent,
  XtendEventType,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/** Builders for the rows screen tests hand the fake service. Override only what a test is about. */

export const settings = {
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

/** The service's rate card at the time of writing. */
export const rates: RateCard = {
  post: 0.015,
  postWithLink: 0.2,
  like: 0.015,
  repost: 0.015,
  follow: 0.015,
  dm: 0.015,
  delete: 0.01,
  readPage: 0.005,
  profile: 0.01,
  searchPage: 0.00075,
  scraperProfile: 0.00022,
  followersPage: 0.001,
  trending: 0.001,
  likersPage: 0.2,
  repostersPage: 0.001,
};

export const paid = (usd: number): CostQuote => ({ usd, cached: false });

/** A `costs.quote` handler: the rate card, and `quote` for each action asked about. */
export const quoting =
  (quote: (action: CostAction) => CostQuote = () => paid(0.001)) =>
  ({ actions }: { readonly actions: ReadonlyArray<CostAction> }) =>
    Effect.succeed({ rates, quotes: actions.map(quote) });

/** Live events the test pushes: answer `"events.subscribe": events.subscribe`, then `events.emit(...)`. */
export const liveEvents = () => {
  const queue = Effect.runSync(Queue.unbounded<XtendEvent>());
  return {
    subscribe: () => Stream.fromQueue(queue),
    emit: (type: XtendEventType, payload: XtendEvent["payload"] = {}) =>
      Queue.offerUnsafe(queue, { type, at: new Date().toISOString(), payload }),
  };
};

export const draft = (id: string, status: Draft["status"], extra: Partial<Draft> = {}): Draft => ({
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
  scheduledAt: null,
  postIds: [],
  error: null,
  attempts: 0,
  postedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  ...extra,
});

export const xPost = (postId: string, text: string, extra: Partial<XPost> = {}): XPost => ({
  postId,
  url: `https://x.com/levelsio/status/${postId}`,
  text,
  createdAt: "2026-10-23T00:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "1",
    handle: "levelsio",
    name: "Pieter",
    followers: 1000,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views: 5000, likes: 200, reposts: 10, replies: 5, quotes: 1, bookmarks: 3 },
  ...extra,
});
