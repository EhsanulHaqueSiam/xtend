import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as XClient from "../x/XClient.ts";

const unused = () => Effect.die("not stubbed for this test");

/** An XClient whose every method dies unless the test overrides it. */
export const xClientStub = (overrides: Partial<XClient.XClient["Service"]>) =>
  Layer.succeed(XClient.XClient)({
    searchPosts: unused,
    profile: unused,
    userPosts: unused,
    followers: unused,
    trending: unused,
    me: unused,
    createPost: unused,
    deletePost: unused,
    like: unused,
    repost: unused,
    sendDm: unused,
    mentions: unused,
    cached: {
      search: () => Effect.succeed(false),
      profile: () => Effect.succeed(false),
      userPosts: () => Effect.succeed(false),
      followers: () => Effect.succeed(false),
      trending: () => Effect.succeed(false),
      me: Effect.succeed(false),
      mentions: () => Effect.succeed(false),
    },
    ...overrides,
  });
