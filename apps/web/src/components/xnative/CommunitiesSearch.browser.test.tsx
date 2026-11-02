import type { EngineBatch, EngineCommunity } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { CommunitiesSearch } from "./CommunitiesSearch";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";

vi.mock("../shell/HomeCompanion", () => ({ DayGlance: () => null }));

const community = (id: string, name: string, extra: Partial<EngineCommunity> = {}) => ({
  communityId: id,
  name,
  description: null,
  bannerUrl: null,
  members: 4200,
  topic: "Software",
  rules: null,
  joinPolicy: null,
  role: null,
  ...extra,
});

/** X's answer to one tab of a search of Communities, as the capture keys it: by the query. */
const answer = (op: string, query: string, extra: Partial<EngineBatch> = {}): EngineBatch => ({
  op,
  key: query,
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

it("searches Communities on X's page for the open tab: the Communities X finds, its posts, and X's line when it finds none", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/home",
    loadURL: (url: string) => (scripts.push(url), Promise.resolve()),
  } as unknown as XWebview);
  markXReady();
  const moved = (path: string) => scripts.some((s) => s.includes(JSON.stringify(path)));
  const ui = (q: string, tab: "communities" | "top") => (
    <>
      <EngineSync />
      <CommunitiesSearch key={`${q}:${tab}`} q={q} tab={tab} />
    </>
  );
  try {
    await using screen = await render(ui("makers", "communities"), {
      service: { "settings.get": () => Effect.succeed(settings) },
    });
    await expect.poll(() => moved("/i/communities/suggested?q=makers")).toBe(true);
    await expect.element(screen.getByText("Searching Communities on X.")).toBeVisible();
    bridge.emitEngine(
      answer("CommunitiesSearchQuery", "makers", {
        communities: [
          community("21", "Makers"),
          community("20", "Tools", { members: 12, topic: null }),
        ],
      }),
    );
    // X's order, each row its name, members and topic.
    await expect
      .poll(() =>
        [...screen.container.querySelectorAll('[data-x="community-row"]')].map(
          (row) => row.textContent,
        ),
      )
      .toEqual(["Makers4.2K Members · Software", "Tools12 Members"]);

    // X answered with nothing: its own line, not a wait for X.
    await screen.rerender(ui("zzz", "communities"));
    await expect.poll(() => moved("/i/communities/suggested?q=zzz")).toBe(true);
    bridge.emitEngine(answer("CommunitiesSearchQuery", "zzz"));
    await expect
      .element(
        screen.getByText(
          "The term you entered did not bring up any results. Try a different search term.",
        ),
      )
      .toBeVisible();

    // Top is X's other page, its posts from Communities.
    const post = synth().home!.batches.find((b) => b.posts.length > 0)!.posts[0]!;
    await screen.rerender(ui("makers", "top"));
    await expect.poll(() => moved("/i/communities/top?q=makers")).toBe(true);
    bridge.emitEngine(
      answer("GlobalCommunitiesPostSearchTimeline", "makers", {
        posts: [post],
        order: [post.postId],
      }),
    );
    await expect
      .poll(() =>
        [...screen.container.querySelectorAll("article[data-post]")].map(
          (a) => (a as HTMLElement).dataset.post,
        ),
      )
      .toEqual([post.postId]);
  } finally {
    registerXWebview(null);
  }
});
