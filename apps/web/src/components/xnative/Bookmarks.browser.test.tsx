import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { EngineBatch, EnginePost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { EngineSync } from "./EngineSync";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { Route as BookmarksRoute } from "../../routes/bookmarks";

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

const post = (postId: string, text: string): EnginePost => ({
  postId,
  author: { userId: "1", handle: "ann", name: "Ann", followers: 10, verified: false },
  text,
  createdAt: "2026-11-02T03:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 10, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 1 },
  avatarUrl: null,
  media: [],
  quotedId: null,
  replyToId: null,
  replyingTo: [],
  entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
  card: null,
  poll: null,
  note: null,
  context: null,
  liked: false,
  reposted: false,
  bookmarked: true,
  conversation: null,
  edits: [],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
});

/** The Bookmarks screen under a router that holds its route, with a fake engine page. */
async function open() {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  // X's page follows X's router as the engine's moves drive it; X leaves a dialog's route at once.
  let url = "https://x.com/home";
  registerXWebview({
    executeJavaScript: (code: string) => {
      scripts.push(code);
      const to = /pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
      if (to !== undefined) url = `https://x.com${to}`;
      if (code.startsWith("location.pathname === ")) return Promise.resolve(false);
      return Promise.resolve(true);
    },
    getURL: () => url,
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/bookmarks",
        validateSearch: BookmarksRoute.options.validateSearch,
        component: BookmarksRoute.options.component!,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/bookmarks"] }),
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
  return { bridge, scripts, screen, url: () => url };
}

it("tells an account without folders from X's answers when X never sends its claims: X's upsell", async () => {
  const { bridge, screen } = await open();
  try {
    // Before X answers, the plain title.
    await expect.element(screen.getByText("Loading your bookmarks from X.")).toBeVisible();
    expect(screen.getByRole("button", { name: /bookmark folders/ }).elements()).toHaveLength(0);
    // X answers Bookmarks (none saved) with no folder list beside it, and never its claims.
    bridge.emitEngine(batch("Bookmarks", { key: "bookmarks", top: "t" }));
    await expect.element(screen.getByText("Save posts for later")).toBeVisible();
    await screen.getByRole("button", { name: "Bookmarks, bookmark folders" }).click();
    await expect.element(page.getByText("Unlock bookmark folders with Plus")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Upgrade" }))
      .toHaveAttribute("href", "https://x.com/i/premium_sign_up?referring_page=bookmark_folders");
  } finally {
    await screen[Symbol.asyncDispose]();
    registerXWebview(null);
  }
});

it("lists X's folders, opens one on X's folder page, and opens X's own folder dialogs", async () => {
  const { bridge, scripts, screen, url } = await open();
  try {
    // X's folder list says Premium, its claims or not.
    bridge.emitEngine(
      batch("BookmarkFoldersSlice", {
        bookmarkFolders: {
          kind: "list",
          folders: [
            { folderId: "801", name: "Reading", imageUrl: null },
            { folderId: "802", name: "Ideas", imageUrl: null },
          ],
        },
      }),
    );
    const menu = () => screen.getByRole("button", { name: /bookmark folders$/ });
    const rows = () =>
      page
        .getByRole("menu", { name: "Bookmark folders" })
        .getByRole("menuitem")
        .elements()
        .map((m) => `${m.textContent}${m.querySelector('[aria-label="Open"]') ? " (open)" : ""}`);
    await menu().click();
    await expect.poll(rows).toEqual(["All Bookmarks (open)", "Reading", "Ideas", "Create Folder"]);
    await page.getByRole("menuitem", { name: "Reading" }).click();
    await expect.poll(url).toBe("https://x.com/i/bookmarks/801");
    bridge.emitEngine(
      batch("BookmarkFolderTimeline", {
        key: "801",
        posts: [post("72", "Folder take")],
        order: ["72"],
      }),
    );
    await expect.element(screen.getByText("Folder take")).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: /Reading/ })).toBeVisible();

    // X's own dialog for the open folder, on X's route for it; X's answer renames it here.
    await menu().click();
    await expect
      .poll(rows)
      .toEqual([
        "All Bookmarks",
        "Reading (open)",
        "Ideas",
        "Create Folder",
        "Edit Folder",
        "Delete Folder",
      ]);
    await page.getByRole("menuitem", { name: "Edit Folder" }).click();
    await expect
      .poll(() => scripts.some((s) => s.includes('pushState(null, "", "/i/bookmarks/801/edit")')))
      .toBe(true);
    bridge.emitEngine(
      batch("EditBookmarkFolder", {
        bookmarkFolders: {
          kind: "saved",
          folder: { folderId: "801", name: "To read", imageUrl: null },
        },
      }),
    );
    await expect.element(screen.getByRole("heading", { name: /To read/ })).toBeVisible();

    // An empty folder says so in X's words; one X deleted leaves All Bookmarks open.
    await menu().click();
    await page.getByRole("menuitem", { name: "Ideas" }).click();
    await expect.poll(url).toBe("https://x.com/i/bookmarks/802");
    bridge.emitEngine(batch("BookmarkFolderTimeline", { key: "802", top: "t", bottom: "b" }));
    await expect.element(screen.getByText("Save posts for later")).toBeVisible();
    bridge.emitEngine(
      batch("DeleteBookmarkFolder", { bookmarkFolders: { kind: "deleted", folderId: "802" } }),
    );
    await expect.poll(url).toBe("https://x.com/i/bookmarks");
    await expect.element(screen.getByRole("heading", { name: /^Bookmarks/ })).toBeVisible();

    await menu().click();
    await page.getByRole("menuitem", { name: "Create Folder" }).click();
    await expect
      .poll(() =>
        scripts.some((s) => s.includes('pushState(null, "", "/i/bookmarks/create_folder")')),
      )
      .toBe(true);
  } finally {
    await screen[Symbol.asyncDispose]();
    registerXWebview(null);
  }
});
