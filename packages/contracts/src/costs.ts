import * as Schema from "effect/Schema";

import { XHandle } from "./baseSchemas.ts";
import { XSearchMode } from "./x.ts";

/**
 * The one rate card. The service owns the numbers (XClient.RATE_CARD) and
 * clients ask `costs.quote` for them, so a price change never drifts.
 */
export const RateCard = Schema.Struct({
  /** X's own-account prices through treg. */
  post: Schema.Number,
  postWithLink: Schema.Number,
  like: Schema.Number,
  repost: Schema.Number,
  follow: Schema.Number,
  dm: Schema.Number,
  delete: Schema.Number,
  /** One page of an own-account read (mentions). */
  readPage: Schema.Number,
  /** Own-account profile (`me`). */
  profile: Schema.Number,
  /** Scraper reads. */
  searchPage: Schema.Number,
  scraperProfile: Schema.Number,
  followersPage: Schema.Number,
  trending: Schema.Number,
  /** Who liked a post: one capped page of X's liking_users (Leads lists, the automate likes poll). */
  likersPage: Schema.Number,
  /** Who reposted a post: one scraper page (Leads lists, the automate reposts poll). */
  repostersPage: Schema.Number,
});
export type RateCard = typeof RateCard.Type;

/**
 * Only domains X actually turns into t.co links count. The old `\w+\.\w{2,}`
 * rule priced "Node.js" as a link.
 */
const LINK_TLDS =
  "com|net|org|io|dev|app|ai|co|me|sh|so|to|gg|xyz|info|biz|tv|fm|ly|us|uk|de|fr|ca|au|in|jp|eu|edu|gov";
export const LINK_PATTERN = new RegExp(
  `https?:\\/\\/\\S+|\\bwww\\.\\S+|\\b[a-z0-9-]+\\.(?:${LINK_TLDS})(?:\\/\\S*)?(?=$|[\\s),.!?;:])`,
  "i",
);
export const hasLink = (text: string) => LINK_PATTERN.test(text);
export const postCostUsd = (rates: RateCard, text: string) =>
  hasLink(text) ? rates.postWithLink : rates.post;

/** A paid thing a screen is about to do. The service prices it and says whether a cache would serve it for free. */
export const CostAction = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("post"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("like") }),
  Schema.Struct({ kind: Schema.Literal("repost") }),
  Schema.Struct({ kind: Schema.Literal("dm") }),
  /** `mode` and `cursor` are the ones the search will run with; each mode and page is cached apart. */
  Schema.Struct({
    kind: Schema.Literal("search"),
    query: Schema.String,
    mode: Schema.optional(XSearchMode),
    cursor: Schema.optional(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("profile"), handle: XHandle }),
  Schema.Struct({ kind: Schema.Literal("userPosts"), handle: XHandle }),
  /** A new-follower check's page: a cached copy only counts while it is minutes old. */
  Schema.Struct({ kind: Schema.Literal("followersPage"), handle: XHandle }),
  Schema.Struct({ kind: Schema.Literal("trending"), country: Schema.String }),
  /** One page of mentions newer than the newest one stored, as `engage.mentions` refreshes. */
  Schema.Struct({ kind: Schema.Literal("mentions") }),
  /** Profile plus the follower pages one score run reads. */
  Schema.Struct({ kind: Schema.Literal("scoreRun"), handle: XHandle }),
  /** Own profile plus the timeline pages one Analyze refresh reads. */
  Schema.Struct({ kind: Schema.Literal("analyzeRefresh") }),
  Schema.Struct({ kind: Schema.Literal("competitorFetch"), handle: XHandle }),
  /** One search per keyword not yet fetched today. */
  Schema.Struct({ kind: Schema.Literal("picksFetch") }),
  /** One search per keyword in Settings, up to the engage limit. */
  Schema.Struct({ kind: Schema.Literal("engageTargets") }),
  /** One own-timeline page, free once the session saw VOICE_MIN_SEEN of the user's posts. */
  Schema.Struct({ kind: Schema.Literal("findKeywords") }),
  /**
   * One model call (draft, remix, reply, Ask). Quoted at what Assist reserves against the
   * budget before the call; the bill settles at what the model charged, usually less.
   */
  Schema.Struct({ kind: Schema.Literal("assist") }),
]);
export type CostAction = typeof CostAction.Type;

export const CostQuote = Schema.Struct({
  usd: Schema.Number,
  /** True when every read behind the action is still in the service's cache: the click is free. */
  cached: Schema.Boolean,
});
export type CostQuote = typeof CostQuote.Type;

export const CostQuoteResult = Schema.Struct({
  rates: RateCard,
  /** One quote per requested action, same order. */
  quotes: Schema.Array(CostQuote),
});
export type CostQuoteResult = typeof CostQuoteResult.Type;

export const Costs_METHODS = { quote: "costs.quote" } as const;
