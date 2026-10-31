import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { XId } from "./baseSchemas.ts";
import type { ObservedPost } from "./observation.ts";

/**
 * Desktop contracts. The service cannot touch the x.com session itself, so it
 * asks the connected desktop over a command stream and waits for the answer.
 * Owned by the desktop area.
 */

export const DesktopCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("sessionScreenshot") }),
  /** Drives x.com's own composer in the session view; honoured only when settings.sessionPostingEnabled. */
  Schema.Struct({
    type: Schema.Literal("sessionPost"),
    text: Schema.String,
    mediaPaths: Schema.Array(Schema.String),
    replyToPostId: Schema.optional(XId),
  }),
  Schema.Struct({ type: Schema.Literal("sessionNavigate"), url: Schema.String }),
  /** Clicks X's own like on the post's page in the session view; same setting as sessionPost. */
  Schema.Struct({ type: Schema.Literal("sessionLike"), postId: XId }),
  /** Sends a DM through X's own message composer in the session view; same setting as sessionPost. */
  Schema.Struct({ type: Schema.Literal("sessionDm"), userId: XId, text: Schema.String }),
]);
export type DesktopCommand = typeof DesktopCommand.Type;

/**
 * How long the desktop may spend on a command, counted from when it receives it. It gives up by
 * then and says why; the service waits a little longer for that answer. A session post loads X's
 * composer, uploads its media (a video can take minutes) and waits for X to confirm.
 */
export const DESKTOP_COMMAND_LIMIT_MS = {
  sessionScreenshot: 20_000,
  sessionNavigate: 20_000,
  sessionPost: 180_000,
  sessionLike: 30_000,
  sessionDm: 45_000,
} satisfies Record<DesktopCommand["type"], number>;

export const DesktopCommandResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("sessionScreenshot"), pngBase64: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sessionPost"), postId: XId }),
  Schema.Struct({ type: Schema.Literal("sessionNavigate") }),
  Schema.Struct({ type: Schema.Literal("sessionLike") }),
  Schema.Struct({ type: Schema.Literal("sessionDm") }),
]);
export type DesktopCommandResult = typeof DesktopCommandResult.Type;

/** The result the desktop answers for a command of the same `type`. */
export type DesktopCommandResultFor<C extends DesktopCommand> = Extract<
  DesktopCommandResult,
  { type: C["type"] }
>;

export const DesktopCommandRequest = Schema.Struct({
  id: Schema.String,
  command: DesktopCommand,
});
export type DesktopCommandRequest = typeof DesktopCommandRequest.Type;

export const DesktopCommandCompletion = Schema.Struct({
  id: Schema.String,
  result: Schema.NullOr(DesktopCommandResult),
  /** Why the desktop could not run the command; set only when `result` is null. */
  error: Schema.NullOr(Schema.String),
  /** The desktop refused before touching the session view, so nothing went to X and sending it again is safe. */
  notAttempted: Schema.optional(Schema.Boolean),
});
export type DesktopCommandCompletion = typeof DesktopCommandCompletion.Type;

export class DesktopUnavailableError extends Schema.TaggedError<DesktopUnavailableError>()(
  "DesktopUnavailableError",
  {
    reason: Schema.Literals(["no_desktop", "timeout", "failed", "not_attempted"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Desktop ${this.reason}: ${this.detail}`;
  }
}

export const Desktop_METHODS = {
  subscribeCommands: "desktop.subscribeCommands",
  completeCommand: "desktop.completeCommand",
} as const;

export const DesktopRpcGroup = RpcGroup.make(
  Rpc.make(Desktop_METHODS.subscribeCommands, {
    payload: Schema.Struct({}),
    success: DesktopCommandRequest,
    stream: true,
  }),
  Rpc.make(Desktop_METHODS.completeCommand, {
    payload: DesktopCommandCompletion,
    success: Schema.Void,
  }),
);

/** A photo, video or GIF on a post, as X serves it; `videoUrl` is its best mp4. */
export interface EngineMedia {
  readonly kind: "photo" | "video" | "gif";
  readonly url: string;
  readonly videoUrl: string | null;
  readonly width: number;
  readonly height: number;
}

/** The preview X draws for a post's link (a summary card or a unified card) or its X Article. */
export interface EngineCard {
  readonly kind: "link" | "article";
  /** Where a click goes: the expanded link, or the article on x.com. */
  readonly url: string;
  readonly title: string;
  readonly domain: string | null;
  readonly description: string | null;
  readonly imageUrl: string | null;
}

export interface EnginePoll {
  readonly choices: ReadonlyArray<{ readonly label: string; readonly votes: number }>;
  readonly endsAt: string | null;
  /** X stopped counting: the poll is over. */
  readonly final: boolean;
  /** The 1-based choice the viewer voted for, when they did. */
  readonly voted: number | null;
}

/** A link in a post's text: X sends t.co and shows `display`, which opens `expanded`. */
export interface EngineLink {
  readonly url: string;
  readonly expanded: string;
  readonly display: string;
}

/**
 * The line X draws above a post: "Pinned", "Theo reposted", "Theo liked". `type` is X's own
 * context type (Pin, Retweet, Like, Follow, ...); `handle` is the person named, when there is one.
 */
export interface EngineContext {
  readonly type: string;
  readonly text: string;
  readonly handle: string | null;
}

/**
 * A post as Xtend's own X screens draw it: the observed post plus what drawing needs. It goes
 * from the desktop to the app page only, never to the service or the pool.
 */
export interface EnginePost extends ObservedPost {
  readonly avatarUrl: string | null;
  readonly media: ReadonlyArray<EngineMedia>;
  readonly quotedId: string | null;
  readonly replyToId: string | null;
  /** "Replying to @a @b": the handles X moved out of the text. */
  readonly replyingTo: ReadonlyArray<string>;
  readonly links: ReadonlyArray<EngineLink>;
  readonly card: EngineCard | null;
  readonly poll: EnginePoll | null;
  /** A Community Note's text ("Readers added context"). */
  readonly note: string | null;
  readonly context: EngineContext | null;
  /** The viewer's own state on X, as X draws its buttons. */
  readonly liked: boolean;
  readonly reposted: boolean;
  readonly bookmarked: boolean;
}

/** A person as X lists them (search People, Who to follow, a profile's header). */
export interface EngineUser {
  readonly userId: string;
  readonly handle: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly bannerUrl: string | null;
  readonly bio: string;
  readonly location: string | null;
  readonly website: { readonly url: string; readonly display: string } | null;
  readonly joinedAt: string | null;
  readonly followers: number | null;
  readonly following: number | null;
  readonly posts: number | null;
  readonly verified: boolean;
  readonly isProtected: boolean;
  readonly youFollow: boolean;
  readonly followsYou: boolean;
  readonly pinnedPostId: string | null;
}

/** A trend on Explore; `url` is the x.com page it opens (a search, or X's trend page). */
export interface EngineTrend {
  readonly name: string;
  /** "Trending in Bangladesh", "18 hours ago · News · 24K posts". */
  readonly context: string | null;
  readonly url: string;
  readonly images: ReadonlyArray<string>;
  /** The section X put it under ("Today's News"), when it has one. */
  readonly group: string | null;
}

/**
 * One row of X's notifications: an event ("Theo liked your post", "X followed you") with the
 * people and posts it names, or a post itself (a reply or a mention), where `postIds` is that post.
 */
export interface EngineNotification {
  readonly id: string;
  readonly kind: "event" | "post";
  /** X's icon name: heart_icon, person_icon, retweet_icon, bell_icon, ... */
  readonly icon: string;
  readonly text: string;
  readonly at: string | null;
  readonly users: ReadonlyArray<Pick<EngineUser, "userId" | "handle" | "name" | "avatarUrl">>;
  readonly postIds: ReadonlyArray<string>;
}

/** A List as X's Lists page shows it. */
export interface EngineList {
  readonly listId: string;
  readonly name: string;
  readonly description: string;
  readonly members: number | null;
  readonly followers: number | null;
  readonly isPrivate: boolean;
  readonly bannerUrl: string | null;
  readonly owner: Pick<EngineUser, "userId" | "handle" | "name" | "avatarUrl"> | null;
  /** "Your Lists", "Discover new Lists". */
  readonly group: string | null;
}

/**
 * A tab the user pinned to X's Home after For you and Following: a topic, a Community or a List.
 * `id` is the surface its posts land in (`tag:<id>`, `community:<id>`, `list:<id>`); `label` is
 * the tab's text on X, which is how the engine picks it.
 */
export interface EngineHomeTab {
  readonly id: `tag:${string}` | `community:${string}` | `list:${string}`;
  readonly label: string;
}

/** A tab on X's Explore; its trends and posts land in `explore:<timelineId>`. */
export interface EngineExploreTab {
  readonly id: string;
  readonly label: string;
  readonly timelineId: string;
}

/**
 * One GraphQL response the engine received, by operation (HomeTimeline, TweetDetail, ...). `key`
 * names what the request asked for when one operation serves many pages (a Home tab's tag, a
 * Community, a List, a notifications tab); `cursor` is the page cursor it sent, and `top` and
 * `bottom` the cursors X answered with, so a fetch of newer posts is told from the next page.
 */
export interface EngineBatch {
  readonly op: string;
  readonly key: string | null;
  readonly cursor: string | null;
  readonly top: string | null;
  readonly bottom: string | null;
  readonly posts: ReadonlyArray<EnginePost>;
  readonly users: ReadonlyArray<EngineUser>;
  readonly trends: ReadonlyArray<EngineTrend>;
  readonly notifications: ReadonlyArray<EngineNotification>;
  readonly lists: ReadonlyArray<EngineList>;
  readonly homeTabs: ReadonlyArray<EngineHomeTab> | null;
  readonly exploreTabs: ReadonlyArray<EngineExploreTab> | null;
}
