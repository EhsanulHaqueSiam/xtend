import {
  ComposeError,
  type DesktopUnavailableError,
  type DraftPoll,
  isComposeError,
  type ReplySettings,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopChannel from "../desktop/DesktopChannel.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

const SESSION_POSTING_OFF =
  "Session actions are off in Settings; turn them on to go through your x.com session";

/** A clicked action within this gap of the last one, or over the hourly count, is refused. */
const PACE_GAP_MS = 8_000;
const PACE_PER_HOUR = 30;

/**
 * Posting through the desktop's x.com session view: the free lane for what the user clicks, poll
 * and reply setting included, and the only path for media until treg uploads it. Refuses while
 * session actions are off. `paced` writes keep a human pace so clicks never look like a script.
 */
export class SessionPosting extends Context.Service<
  SessionPosting,
  {
    /**
     * The desktop's own error comes through as is: the publisher must tell a desktop that never
     * got the post from one that went quiet after it may have clicked Post.
     */
    readonly post: (input: {
      readonly text: string;
      readonly mediaPaths: ReadonlyArray<string>;
      readonly replyToPostId?: string;
      /** Picked in X's own composer before Post; X's default (everyone) when absent. */
      readonly replySettings?: ReplySettings;
      readonly poll?: DraftPoll;
      readonly paced?: boolean;
    }) => Effect.Effect<{ readonly postId: string }, ComposeError | DesktopUnavailableError>;
    /** Presses X's own like on the post in the session view, at human pace. */
    readonly like: (postId: string) => Effect.Effect<void, ComposeError | DesktopUnavailableError>;
    /** Sends a DM through X's own message composer in the session view, at the same human pace. */
    readonly dm: (
      userId: string,
      text: string,
    ) => Effect.Effect<void, ComposeError | DesktopUnavailableError>;
    /** Points the session view at a URL (used to hand a freshly posted link card to the desktop). */
    readonly navigate: (url: string) => Effect.Effect<void, ComposeError>;
  }
>()("xtend/compose/SessionPosting") {}

const make = Effect.gen(function* () {
  const desktop = yield* DesktopChannel.DesktopChannel;
  const settings = yield* SettingsStore.SettingsStore;
  const fail = (operation: string) => (cause: { readonly message: string }) =>
    isComposeError(cause) ? cause : new ComposeError({ operation, detail: cause.message });

  const requireEnabled = Effect.gen(function* () {
    const { sessionPostingEnabled } = yield* settings.get;
    if (!sessionPostingEnabled)
      return yield* new ComposeError({ operation: "sessionPost", detail: SESSION_POSTING_OFF });
  });

  // Instants of paced writes in the last hour; a thread's blocks are one click and skip this.
  const paced: Array<number> = [];
  const humanPace = Effect.map(Clock.currentTimeMillis, (now) => {
    while (paced.length > 0 && paced[0]! < now - 3_600_000) paced.shift();
    const last = paced.at(-1);
    if (last !== undefined && now - last < PACE_GAP_MS)
      return `Human pace: wait ${Math.ceil((PACE_GAP_MS - (now - last)) / 1000)}s`;
    if (paced.length >= PACE_PER_HOUR)
      return `Human pace: ${PACE_PER_HOUR} an hour; next in ${Math.ceil((paced[0]! + 3_600_000 - now) / 60_000)}m`;
    paced.push(now);
    return null;
  });

  const post = Effect.fn("SessionPosting.post")(function* (input: {
    readonly text: string;
    readonly mediaPaths: ReadonlyArray<string>;
    readonly replyToPostId?: string;
    readonly replySettings?: ReplySettings;
    readonly poll?: DraftPoll;
    readonly paced?: boolean;
  }) {
    yield* requireEnabled.pipe(Effect.mapError(fail("sessionPost")));
    if (input.paced === true) {
      const refused = yield* humanPace;
      if (refused !== null)
        return yield* new ComposeError({ operation: "sessionPost", detail: refused });
    }
    const result = yield* desktop.request({
      type: "sessionPost",
      text: input.text,
      mediaPaths: input.mediaPaths,
      ...(input.replyToPostId === undefined ? {} : { replyToPostId: input.replyToPostId }),
      ...(input.replySettings === undefined || input.replySettings === "everyone"
        ? {}
        : { replySettings: input.replySettings }),
      ...(input.poll === undefined ? {} : { poll: input.poll }),
    });
    return { postId: result.postId };
  });

  // Shares the pace with posts: to X, a like and a reply are both one person clicking.
  const like = Effect.fn("SessionPosting.like")(function* (postId: string) {
    yield* requireEnabled.pipe(Effect.mapError(fail("sessionLike")));
    const refused = yield* humanPace;
    if (refused !== null)
      return yield* new ComposeError({ operation: "sessionLike", detail: refused });
    yield* desktop.request({ type: "sessionLike", postId });
  });

  const dm = Effect.fn("SessionPosting.dm")(function* (userId: string, text: string) {
    yield* requireEnabled.pipe(Effect.mapError(fail("sessionDm")));
    const refused = yield* humanPace;
    if (refused !== null)
      return yield* new ComposeError({ operation: "sessionDm", detail: refused });
    yield* desktop.request({ type: "sessionDm", userId, text });
  });

  const navigate = Effect.fn("SessionPosting.navigate")(
    function* (url: string) {
      yield* requireEnabled;
      yield* desktop.request({ type: "sessionNavigate", url });
    },
    Effect.mapError(fail("sessionNavigate")),
  );

  return SessionPosting.of({ post, like, dm, navigate });
});

export const layer = Layer.effect(SessionPosting, make);
