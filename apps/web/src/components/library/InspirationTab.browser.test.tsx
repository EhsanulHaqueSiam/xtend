import type { EngineBatch, EnginePost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { synth } from "../xnative/engineFixtures";
import { InspirationTab } from "./InspirationTab";

/** X's answer for one set of Inspiration filters, as the capture keys it. */
const answer = (filters: string, post: EnginePost): EngineBatch => ({
  op: "GenericTimelineById",
  key: `inspiration:${filters}:en`,
  cursor: null,
  top: null,
  bottom: null,
  posts: [post],
  users: [],
  people: [],
  sections: [],
  order: [post.postId],
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
});

it("draws X's Inspiration as X's page filters it, presses X's own filter for a pick, and saves a post", async () => {
  const [today, week] = synth()
    .home!.batches.flatMap((b) => b.posts)
    .filter((p) => p.quotedId === null);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve(true);
    },
  } as unknown as XWebview);
  markXReady();
  const saves: Array<string> = [];
  try {
    await using screen = await render(
      <>
        <EngineSync />
        <InspirationTab />
      </>,
      {
        service: {
          "library.savedIds": () => Effect.succeed([]),
          "library.savedList": () => Effect.succeed({ items: [], total: 0 }),
          "library.collectionsList": () => Effect.succeed([]),
          "library.save": ({ post }) => {
            saves.push(post.url);
            return Effect.succeed({
              id: 1,
              post,
              note: "",
              savedAt: "2026-11-02T09:00:00.000Z",
              collectionIds: [],
            });
          },
        },
      },
    );
    // Before X answers, the web app alone says where Inspiration comes from; the engine moves there.
    await expect
      .element(screen.getByText("Inspiration comes from X's own page, in the desktop app."))
      .toBeVisible();
    expect(scripts.some((s) => s.includes('"/i/jf/creators/inspiration/top_posts"'))).toBe(true);

    bridge.emitEngine(answer("Likes:Daily", today!));
    await expect.element(screen.getByText(today!.text)).toBeVisible();
    await expect.element(screen.getByText("💬 EN")).toBeVisible();
    await expect
      .element(screen.getByRole("tab", { name: "Last 24h" }))
      .toHaveAttribute("aria-selected", "true");

    // A pick presses X's own button and waits for X's answer for it, not the last list.
    await userEvent.click(screen.getByRole("tab", { name: "Last 7d" }));
    await expect.poll(() => scripts.some((s) => s.includes('"Last 7d"'))).toBe(true);
    await expect
      .element(screen.getByRole("tab", { name: "Last 7d" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(screen.getByText(today!.text)).not.toBeInTheDocument();
    bridge.emitEngine(answer("Likes:Weekly", week!));
    const card = screen.getByRole("article").filter({ hasText: week!.text });
    await userEvent.hover(card);
    await userEvent.click(card.getByRole("button", { name: "Save", exact: true }));
    expect(saves).toEqual([`https://x.com/${week!.author.handle}/status/${week!.postId}`]);

    await userEvent.click(screen.getByRole("button", { name: "Most Likes" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Most Replies" }));
    await expect.poll(() => scripts.some((s) => s.includes('"Most Replies"'))).toBe(true);
  } finally {
    registerXWebview(null);
  }
});
