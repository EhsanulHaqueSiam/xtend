import { ComposeError, type EnginePost, type PostEdit } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";

// The session lane reads the bridge at module load (env.ts), so the screens are imported after it.
const bridge = installFakeBridge();
const { EngineSync } = await import("./EngineSync");
const { Timeline } = await import("./Timeline");
const { markXReady, registerXWebview } = await import("../../state/x");

const TCO = "https://t.co/abc";
const LINK = "https://xtend.dev/changelog";

/** The user's own post, within X's hour: bold on its first word, X's t.co link in its text. */
const post = (postId: string, text: string, extra: Partial<EnginePost> = {}): EnginePost => ({
  postId,
  author: { userId: "1", handle: "you", name: "You", followers: 10, verified: true },
  text,
  createdAt: "2026-11-26T09:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: true,
  metrics: { views: 10, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  avatarUrl: null,
  media: [],
  quotedId: null,
  replyToId: null,
  replyingTo: [],
  entities: {
    urls: [{ url: TCO, expanded: LINK, display: "xtend.dev/changelog", indices: [15, 31] }],
    mentions: [],
    hashtags: [],
    cashtags: [],
  },
  card: null,
  poll: null,
  note: null,
  context: null,
  liked: false,
  reposted: false,
  bookmarked: false,
  conversation: null,
  edits: ["60"],
  editsRemaining: 4,
  editableUntil: "2026-11-26T10:00:00.000Z",
  aiGenerated: false,
  styles: [{ start: 0, end: 8, style: "Bold" }],
  translation: null,
  ...extra,
});

const batch = (op: string, posts: ReadonlyArray<EnginePost>) => ({
  op,
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts,
  users: [],
  people: [],
  sections: [],
  order: posts.map((p) => p.postId),
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
});

/** X's engine: the post's "..." lists X's own rows, Edit post among them; presses are counted. */
const engine = () => {
  const pressed: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/i/likes",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      if (code.includes("const labels"))
        return Promise.resolve(["Delete", "Edit post", "Pin to your profile"]);
      if (code.includes("item.click()")) pressed.push("row");
      return Promise.resolve(false);
    },
  } as unknown as XWebview);
  markXReady();
  return pressed;
};

const screenWith = (sessionPostingEnabled: boolean, edits: Array<PostEdit>, fail: () => boolean) =>
  render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <Timeline surface="likes" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled }),
        "compose.editPost": (edit) =>
          Effect.suspend(() => {
            edits.push(edit);
            return fail()
              ? Effect.fail(
                  new ComposeError({
                    operation: "sessionEditPost",
                    detail: "X offers no Edit post on it now; the post was not changed",
                  }),
                )
              : Effect.succeed({ postId: "61" });
          }),
      },
    },
  );

const openEdit = async (row: ReturnType<typeof page.getByRole>) => {
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Edit post" }).click();
};

it("turns the post's text into an editor for X's Edit post: Cancel, Update through the session, and an error that keeps the text", async () => {
  const edits: Array<PostEdit> = [];
  let failing = true;
  engine();
  try {
    await using screen = await screenWith(true, edits, () => failing);
    bridge.emitEngine(batch("Likes", [post("60", `Shipping today ${TCO}`)]));
    const row = screen.getByRole("article").first();
    const box = row.getByRole("textbox", { name: "Edit post text" });

    // As X's composer opens it: the link expanded; X's window in the line under it, free.
    await openEdit(row);
    await expect.element(box).toHaveValue(`Shipping today ${LINK}`);
    await expect.element(row.getByText(/^4 edits left · until .+ · free · 38\/280$/)).toBeVisible();
    await expect.element(row.getByRole("button", { name: "Update" })).toBeDisabled();
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect.element(box).not.toBeInTheDocument();
    await expect.element(row.getByText("xtend.dev/changelog")).toBeVisible();

    await openEdit(row);
    await userEvent.fill(box, `Shipping today ${LINK} for real`);
    await row.getByRole("button", { name: "Update" }).click();
    // Nothing lost: X's refusal in place, the text still in the editor.
    await expect
      .element(row.getByRole("alert"))
      .toHaveTextContent(
        "Compose sessionEditPost failed: X offers no Edit post on it now; the post was not changed",
      );
    await expect.element(box).toHaveValue(`Shipping today ${LINK} for real`);

    failing = false;
    await row.getByRole("button", { name: "Update" }).click();
    await expect.element(box).not.toBeInTheDocument();
    const sent = {
      postId: "60",
      text: `Shipping today ${LINK} for real`,
      styles: post("60", "").styles,
    };
    expect(edits).toEqual([sent, sent]);

    // X's answer to the edit takes the post's place, with "Last edited".
    bridge.emitEngine(
      batch("CreateTweet", [
        post("61", "Shipping today for real", {
          edits: ["60", "61"],
          entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
          styles: [],
        }),
      ]),
    );
    await expect.element(screen.getByText("Shipping today for real")).toBeVisible();
    await expect.element(screen.getByText(/^Last edited /)).toBeVisible();
    expect(screen.getByRole("article").elements()).toHaveLength(1);
  } finally {
    registerXWebview(null);
  }
});

it("with session actions off, X's Edit post opens no editor, as X's other rows press nothing", async () => {
  const pressed = engine();
  try {
    await using screen = await screenWith(false, [], () => false);
    bridge.emitEngine(batch("Likes", [post("60", `Shipping today ${TCO}`)]));
    const row = screen.getByRole("article").first();
    await openEdit(row);
    await expect.element(page.getByRole("menuitem", { name: "Edit post" })).not.toBeInTheDocument();
    await expect
      .element(row.getByRole("textbox", { name: "Edit post text" }))
      .not.toBeInTheDocument();
    expect(pressed).toEqual([]);
  } finally {
    registerXWebview(null);
  }
});
