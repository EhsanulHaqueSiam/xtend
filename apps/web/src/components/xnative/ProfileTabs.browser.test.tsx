import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { EngineBatch, EnginePost, EngineUser } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Route as ProfileRoute } from "../../routes/u.$handle";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";

const batch = (op: string, extra: Partial<EngineBatch>): EngineBatch => ({
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

const person = (userId: string, handle: string, extra: Partial<EngineUser> = {}): EngineUser => ({
  userId,
  handle,
  name: handle[0]!.toUpperCase() + handle.slice(1),
  avatarUrl: null,
  bannerUrl: null,
  bio: "",
  location: null,
  website: null,
  joinedAt: null,
  followers: 10,
  following: 10,
  posts: 10,
  verified: false,
  isProtected: false,
  youFollow: true,
  followsYou: false,
  pinnedPostId: null,
  verifiedType: null,
  avatarShape: "Circle",
  affiliate: null,
  ...extra,
});
const maker = person("50", "maker", { offersSubscriptions: true });
const plain = person("51", "plain", { offersSubscriptions: false });

const repost = (postId: string, text: string): EnginePost => ({
  postId,
  author: { userId: "60", handle: "ann", name: "Ann", followers: 10, verified: false },
  text,
  createdAt: "2026-11-02T03:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 10, likes: 1, reposts: 1, replies: 0, quotes: 0, bookmarks: 0 },
  avatarUrl: null,
  media: [],
  quotedId: null,
  replyToId: null,
  replyingTo: [],
  entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
  card: null,
  poll: null,
  note: null,
  context: { type: "Retweet", text: "Maker reposted", handle: "maker" },
  liked: false,
  reposted: false,
  bookmarked: false,
  conversation: null,
  edits: [],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
});

/** The real profile screen at `path`, under a router that holds its route, with X's page faked. */
async function profile(path: string) {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/u/$handle",
        validateSearch: ProfileRoute.options.validateSearch,
        component: ProfileRoute.options.component!,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <RouterProvider router={router} />
    </div>,
    {
      router: false,
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
      },
    },
  );
  bridge.emitEngine(batch("UserByScreenName", { users: [maker, plain] }));
  /** Whether a script X's page ran moved it to `xPath`. */
  const moved = (xPath: string) => scripts.some((s) => s.includes(`"${xPath}"`));
  return { screen, bridge, scripts, moved, router };
}

it("lists X's profile tabs in X's order, Subs only for a creator, and Reposts reads X's own tab", async () => {
  const { screen, bridge, moved, router } = await profile("/u/maker");
  try {
    const tabs = () => screen.getByRole("tablist", { name: "Profile" }).getByRole("tab").elements();
    await expect
      .poll(() => tabs().map((t) => t.textContent))
      .toEqual(["Posts", "Replies", "Reposts", "Subs", "Highlights", "Articles", "Media"]);

    await screen.getByRole("tab", { name: "Reposts" }).click();
    await expect.poll(() => moved("/maker/reposts")).toBe(true);
    bridge.emitEngine(
      batch("UserRepostsTimeline", {
        key: "50",
        posts: [repost("71", "Worth reading twice")],
        order: ["71"],
      }),
    );
    await expect.element(screen.getByText("Worth reading twice")).toBeVisible();
    await expect.element(screen.getByText("Maker reposted")).toBeVisible();

    await router.navigate({ to: "/u/$handle", params: { handle: "plain" } });
    await expect
      .poll(() => tabs().map((t) => t.textContent))
      .toEqual(["Posts", "Replies", "Reposts", "Highlights", "Articles", "Media"]);
  } finally {
    await screen[Symbol.asyncDispose]();
    registerXWebview(null);
  }
});

it("draws X's Subs prompt in X's words, and its Subscribe presses X's own button", async () => {
  const { screen, bridge, scripts, moved } = await profile("/u/maker?tab=subs");
  try {
    await expect.poll(() => moved("/maker/subs")).toBe(true);
    bridge.emitEngine(
      batch("UserSuperFollowTweets", {
        key: "50",
        prompt: {
          header: "Unlock more with Subscriptions",
          body: "@maker has shared 12 Subscriber-only posts. Subscribe to see their exclusive posts and bonus content.",
          button: { text: "Subscribe", url: "https://x.com/maker/superfollows/subscribe" },
        },
      }),
    );
    await expect
      .element(screen.getByRole("heading", { name: "Maker's Subscription posts" }))
      .toBeVisible();
    await expect.element(screen.getByText("Unlock more with Subscriptions")).toBeVisible();
    await expect
      .element(screen.getByText("@maker has shared 12 Subscriber-only posts.", { exact: false }))
      .toBeVisible();
    // X answered: nothing is loading under the prompt.
    expect(screen.getByText("Loading @maker from X.").elements()).toHaveLength(0);

    await screen.getByRole("button", { name: "Subscribe", exact: true }).click();
    await expect.poll(() => scripts.some((s) => s.includes('"subscribe to @maker"'))).toBe(true);
  } finally {
    await screen[Symbol.asyncDispose]();
    registerXWebview(null);
  }
});
