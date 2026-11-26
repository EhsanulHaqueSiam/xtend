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
const { emptyEngine, updateEngine } = await import("../../state/engine");

const TCO = "https://t.co/abc";
const LINK = "https://xtend.dev/changelog";

/**
 * The user's own post, within X's hour: bold on its first word, and a trailing link X draws as
 * the card, so the shown text leaves it out while X's own edit text keeps it, expanded.
 */
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
    urls: [{ url: TCO, expanded: LINK, display: "xtend.dev/changelog", indices: null }],
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
  edit: { text: `${text} ${LINK}`, styles: [{ start: 0, end: 8, style: "Bold" }] },
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

/** X's engine: the post's "..." lists X's own rows, Edit post among them; presses and loads are kept. */
const engine = (at = { url: "https://x.com/i/likes" }) => {
  const pressed: Array<string> = [];
  const moved: Array<string> = [];
  const loaded: Array<string> = [];
  registerXWebview({
    getURL: () => at.url,
    loadURL: (url: string) => (loaded.push(url), Promise.resolve()),
    executeJavaScript: (code: string) => {
      if (code.includes("const labels"))
        return Promise.resolve(["Delete", "Edit post", "Pin to your profile"]);
      if (code.includes("item.click()")) pressed.push("row");
      const path = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
      if (path !== undefined) moved.push(path);
      return Promise.resolve(false);
    },
  } as unknown as XWebview);
  markXReady();
  return { pressed, loaded, moved };
};

/** How X's Edit post went, per Update: refused, Update pressed with no answer from X, or saved. */
type Outcome = "refused" | "unsure" | "saved";

const screenWith = (
  sessionPostingEnabled: boolean,
  edits: Array<PostEdit>,
  outcomes: Array<Outcome>,
  // What the desktop did with X's page while it edited.
  meanwhile: () => void = () => {},
) =>
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
            meanwhile();
            const outcome = outcomes.shift();
            return outcome === "refused"
              ? Effect.fail(
                  new ComposeError({
                    operation: "sessionEditPost",
                    detail: "X offers no Edit post on it now; the post was not changed",
                  }),
                )
              : Effect.succeed({
                  postId: outcome === "unsure" ? null : String(Number(edit.postId) + 1),
                });
          }),
      },
    },
  );

const openEdit = async (row: ReturnType<typeof page.getByRole>) => {
  await row.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Edit post" }).click();
};

it("turns the post's text into an editor for X's Edit post: Cancel, Update through the session, an error that keeps the text, and X's unconfirmed save", async () => {
  const edits: Array<PostEdit> = [];
  // X's page shows the edited post, as the edit left it.
  const { loaded } = engine({ url: "https://x.com/you/status/60" });
  try {
    await using screen = await screenWith(true, edits, ["refused", "unsure", "saved"]);
    bridge.emitEngine(batch("Likes", [post("60", "Shipping today")]));
    const row = screen.getByRole("article").first();
    const box = row.getByRole("textbox", { name: "Edit post text" });
    const update = row.getByRole("button", { name: "Update" });

    // As X's composer opens it: the card's link kept and expanded; X's window under it, free.
    await openEdit(row);
    await expect.element(box).toHaveValue(`Shipping today ${LINK}`);
    await expect.element(row.getByText(/^4 edits left · until .+ · free · 38\/280$/)).toBeVisible();
    await expect.element(update).toBeDisabled();
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect.element(box).not.toBeInTheDocument();
    await expect.element(row.getByText("Shipping today")).toBeVisible();

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

    // X's Update was pressed but its answer never came: no second Update, the text kept.
    await update.click();
    await expect
      .element(row.getByRole("status"))
      .toHaveTextContent("X may have saved this edit; check the post");
    await expect.element(update).toBeDisabled();
    await expect.element(box).toHaveValue(`Shipping today ${LINK} for real`);

    await row.getByRole("button", { name: "Cancel" }).click();
    await openEdit(row);
    await userEvent.fill(box, `Shipping today ${LINK} for real`);
    await update.click();
    // Saved, but this window missed X's answer: its X still shows the edited post, so it opens the
    // new version once, and the editor waits for X's answer there.
    await expect
      .element(row.getByRole("status"))
      .toHaveTextContent("Updated on X; reload the post to see it");
    expect(loaded).toEqual(["https://x.com/you/status/61"]);
    const sent = {
      postId: "60",
      text: `Shipping today ${LINK} for real`,
      styles: [{ start: 0, end: 8, style: "Bold" }],
    };
    expect(edits).toEqual([sent, sent, sent]);

    // X's answer on that page takes the post's place, with "Last edited".
    bridge.emitEngine(
      batch("TweetDetail", [
        post("61", "Shipping today for real", {
          edits: ["60", "61"],
          entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
          styles: [],
        }),
      ]),
    );
    await expect.element(box).not.toBeInTheDocument();
    await expect.element(screen.getByText("Shipping today for real")).toBeVisible();
    await expect.element(screen.getByText(/^Last edited /)).toBeVisible();
    expect(screen.getByRole("article").elements()).toHaveLength(1);
  } finally {
    registerXWebview(null);
  }
});

it("with session actions off, X's Edit post opens no editor, as X's other rows press nothing", async () => {
  const { pressed } = engine();
  try {
    await using screen = await screenWith(false, [], []);
    bridge.emitEngine(batch("Likes", [post("60", "Shipping today")]));
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

it("a saved edit of the post X shows leaves X on the new version, where the Post screen took it", async () => {
  updateEngine(() => emptyEngine);
  const at = { url: "https://x.com/you/status/80" };
  const { moved } = engine(at);
  try {
    // Its own ids: the store outlives a test. X's answer reaches the window first, and the Post screen's own move lands X on the new version.
    await using screen = await screenWith(true, [], ["saved"], () => {
      bridge.emitEngine(
        batch("TweetDetail", [post("81", "Shipping today, edited", { edits: ["80", "81"] })]),
      );
      at.url = "https://x.com/you/status/81";
    });
    bridge.emitEngine(batch("Likes", [post("80", "Shipping today", { edits: ["80"] })]));
    const row = screen.getByRole("article").first();
    await openEdit(row);
    await userEvent.fill(
      row.getByRole("textbox", { name: "Edit post text" }),
      `Shipping today ${LINK} edited`,
    );
    await row.getByRole("button", { name: "Update" }).click();
    await expect.element(screen.getByText("Shipping today, edited")).toBeVisible();
    expect([moved, at.url]).toEqual([[], "https://x.com/you/status/81"]);
  } finally {
    registerXWebview(null);
  }
});

it("puts X's page back where it was once an edit settles, unless the user moved it meanwhile", async () => {
  const at = { url: "https://x.com/home" };
  const { moved } = engine(at);
  // The edit takes X to the post's page; the second time the user took it to Explore themselves.
  const where: Array<string> = [];
  try {
    await using screen = await screenWith(true, [], ["refused", "refused"], () => {
      at.url = where.shift() ?? at.url;
    });
    bridge.emitEngine(batch("Likes", [post("60", "Shipping today")]));
    const row = screen.getByRole("article").first();
    await expect.element(row).toBeVisible();
    // The store outlives a test: the row's post may be an earlier test's version of 60.
    where.push(
      `https://x.com/you/status/${row.element().getAttribute("data-post")}`,
      "https://x.com/explore",
    );
    const box = row.getByRole("textbox", { name: "Edit post text" });
    await openEdit(row);
    await userEvent.fill(box, `Shipping today ${LINK} for real`);
    await row.getByRole("button", { name: "Update" }).click();
    await expect.poll(() => moved).toEqual(["/home"]);
    at.url = "https://x.com/home";
    await row.getByRole("button", { name: "Update" }).click();
    await expect.poll(() => where.length).toBe(0);
    await expect.element(row.getByRole("alert")).toBeVisible();
    expect([moved, at.url]).toEqual([["/home"], "https://x.com/explore"]);
  } finally {
    registerXWebview(null);
  }
});
