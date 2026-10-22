import { ComposeError } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopChannel from "../desktop/DesktopChannel.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

const SESSION_POSTING_OFF =
  "Media posts go through your x.com session; enable Session posting in Settings";

/**
 * Posting through the desktop's x.com session view, the only path for media until treg
 * exposes media upload. Refuses unless the user turned session posting on.
 */
export class SessionPosting extends Context.Service<
  SessionPosting,
  {
    readonly post: (input: {
      readonly text: string;
      readonly mediaPaths: ReadonlyArray<string>;
      readonly replyToPostId?: string;
    }) => Effect.Effect<{ readonly postId: string }, ComposeError>;
    /** Points the session view at a URL (used to hand a freshly posted link card to the desktop). */
    readonly navigate: (url: string) => Effect.Effect<void, ComposeError>;
  }
>()("xtend/compose/SessionPosting") {}

const make = Effect.gen(function* () {
  const desktop = yield* DesktopChannel.DesktopChannel;
  const settings = yield* SettingsStore.SettingsStore;
  const fail = (operation: string) => (cause: { readonly message: string }) =>
    cause instanceof ComposeError
      ? cause
      : new ComposeError({ operation, detail: cause.message });

  const requireEnabled = Effect.gen(function* () {
    const { sessionPostingEnabled } = yield* settings.get;
    if (!sessionPostingEnabled)
      return yield* new ComposeError({ operation: "sessionPost", detail: SESSION_POSTING_OFF });
  });

  const post = Effect.fn("SessionPosting.post")(
    function* (input: {
      readonly text: string;
      readonly mediaPaths: ReadonlyArray<string>;
      readonly replyToPostId?: string;
    }) {
      yield* requireEnabled;
      const result = yield* desktop.request({
        type: "sessionPost",
        text: input.text,
        mediaPaths: input.mediaPaths,
        ...(input.replyToPostId === undefined ? {} : { replyToPostId: input.replyToPostId }),
      });
      return { postId: result.postId };
    },
    Effect.mapError(fail("sessionPost")),
  );

  const navigate = Effect.fn("SessionPosting.navigate")(
    function* (url: string) {
      yield* requireEnabled;
      yield* desktop.request({ type: "sessionNavigate", url });
    },
    Effect.mapError(fail("sessionNavigate")),
  );

  return SessionPosting.of({ post, navigate });
});

export const layer = Layer.effect(SessionPosting, make);
