import type { EngineBatch, EngineUser } from "@xtend/contracts";
import { Suspense } from "react";
import { expect, it, vi } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { Route } from "../../routes/u.$handle_.people";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";

vi.mock("../shell/HomeCompanion", () => ({ DayGlance: () => null }));

const person = (userId: string, handle: string): EngineUser => ({
  userId,
  handle,
  name: handle.toUpperCase(),
  avatarUrl: null,
  bannerUrl: null,
  bio: "",
  location: null,
  website: null,
  joinedAt: null,
  followers: 1,
  following: 1,
  posts: 1,
  verified: false,
  isProtected: false,
  youFollow: false,
  followsYou: false,
  pinnedPostId: null,
  verifiedType: null,
  avatarShape: "Circle",
  affiliate: null,
});

/** One of X's people pages as the desktop's capture sends it, keyed by the person's id. */
const people = (op: string, key: string, users: ReadonlyArray<EngineUser>): EngineBatch => ({
  op,
  key,
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
  users,
  people: users.map((u) => u.userId),
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
});

it("lists X's people for this person's open tab, opens X's page for it, and says when X lists nobody", async () => {
  vi.spyOn(Route, "useParams").mockReturnValue({ handle: "Ann" });
  const search = vi.spyOn(Route, "useSearch").mockReturnValue({ tab: "followers" });
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  try {
    const People = Route.options.component!;
    const ui = () => (
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <Suspense>
          <People />
        </Suspense>
      </div>
    );
    await using screen = await render(ui(), { service: {} });
    await expect.poll(() => scripts.some((s) => s.includes('"/Ann/followers"'))).toBe(true);
    bridge.emitEngine(people("UserByScreenName", "ann", [person("5", "ann")]));
    bridge.emitEngine(people("Followers", "5", [person("12", "zed"), person("11", "amy")]));
    // Someone else's followers, fetched earlier, stay theirs.
    bridge.emitEngine(people("Followers", "9", [person("13", "bob")]));
    await expect.element(screen.getByRole("button", { name: "@zed" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "@amy" })).toBeVisible();
    expect(screen.getByRole("button", { name: "@bob" }).elements()).toHaveLength(0);
    // Followers you know shows only once X counted one for this person (its REST call on the
    // profile), and goes again when X counts none.
    const tabs = () =>
      screen
        .getByRole("tab")
        .elements()
        .map((t) => t.textContent);
    const known = (count: number) =>
      bridge.emitEngine({ ...people("FriendsFollowingList", "5", []), knownFollowers: count });
    const all = ["Verified Followers", "Followers you know", "Followers", "Following"];
    const none = ["Verified Followers", "Followers", "Following"];
    expect(tabs()).toEqual(none);
    known(2);
    await expect.poll(tabs).toEqual(all);
    known(0);
    await expect.poll(tabs).toEqual(none);
    known(2);

    search.mockReturnValue({ tab: "followers_you_follow" });
    await screen.rerender(ui());
    await expect.element(screen.getByText("Loading Followers you know from X.")).toBeVisible();
    bridge.emitEngine(people("FollowersYouKnow", "5", []));
    await expect.element(screen.getByText("No one you follow follows them.")).toBeVisible();

    // On the user's own profile X has no Followers you know.
    await expect.poll(tabs).toEqual(all);
    bridge.emitEngine({
      ...people("Viewer", "", []),
      key: null,
      viewer: { userId: "5", handle: "ann", name: "Ann", avatarUrl: null },
    });
    await expect.poll(tabs).toEqual(none);
  } finally {
    registerXWebview(null);
  }
});
