import "../../index.css";
import type { EnginePost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";

// The screens read the bridge at module load (env.ts), so they are imported after it exists.
installFakeBridge();
const { GrokDrawer } = await import("./Grok");
const { XColumn } = await import("./XColumn");
const { XPostView } = await import("./XPostView");
const { markXReady, registerXWebview } = await import("../../state/x");

const post: EnginePost = {
  postId: "17",
  author: { userId: "1", handle: "rinaships", name: "Rina Okafor", followers: 10, verified: false },
  text: "Shipping on Fridays is fine if rollback is one click.",
  createdAt: "2026-11-03T09:12:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 10, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
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
  bookmarked: false,
  conversation: null,
  edits: [],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
};

// X's pages as the engine holds them: the post with X's Grok button, then X's Grok page
// (bundle.GrokXWeb) with X's analysis of it.
const POST_PAGE = `<main><article><a href="/rinaships/status/17"><time>3h</time></a><button aria-label="Grok actions"></button></article></main>`;
const GROK_PAGE = `<main><div data-testid="primaryColumn"><div><button aria-haspopup="dialog" aria-expanded="false">History</button><a href="/i/grok">New chat</a></div>
  <div role="region"><div data-turn-id="u1"><div class="group/user"><div class="whitespace-pre-wrap">https://x.com/rinaships/status/17</div></div>
  <div data-quotable-message="r1"><div class="flex flex-col gap-3"><div><div><p>The post pairs a common rule with a twist.</p></div></div></div>
  <div class="flex items-center"><div><button aria-label="Good response" aria-pressed="false"><svg data-icon="icon-thumbs-up"></svg></button></div></div></div></div></div>
  <fieldset data-grok-composer=""><textarea placeholder="Ask anything"></textarea><div><button aria-haspopup="menu" aria-expanded="false"><span>Auto</span></button><button aria-label="Voice mode"><svg data-icon="icon-voice"></svg></button></div></fieldset>
</div></main>`;

/** What X's page received, in order: X's Grok button pressed, each move in X's router. */
const inX: Array<string> = [];
let at = "/rinaships/status/17";
const draw = () => {
  document.querySelector("#x")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div id="x">${at.startsWith("/i/grok") ? GROK_PAGE : POST_PAGE}</div>`,
  );
  // X's analysis opens X's drawer on the post's page, which X draws with its own Grok in it.
  document.querySelector('#x [aria-label="Grok actions"]')?.addEventListener("click", () => {
    inX.push("Grok actions");
    document
      .querySelector("#x")!
      .insertAdjacentHTML(
        "beforeend",
        `<div data-testid="GrokDrawer"><fieldset data-grok-composer=""></fieldset></div>`,
      );
  });
};
registerXWebview({
  loadURL: async () => {},
  getURL: () => `https://x.com${at}`,
  executeJavaScript: (code: string) => {
    const to = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
    if (to !== undefined) {
      inX.push(`go ${to}`);
      at = to;
      draw();
      return Promise.resolve(true);
    }
    return Promise.resolve(
      new Function(`return ${code.replaceAll("location.pathname", JSON.stringify(at))}`)(),
    );
  },
} as unknown as XWebview);
markXReady();
const service = {
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
};

it("Explain this post presses X's own Grok button on the post, then docks X's Grok page beside it", async () => {
  draw();
  await using screen = await render(
    <div style={{ height: 800, width: 1200 }}>
      <XColumn header={null}>
        <XPostView post={post} />
      </XColumn>
    </div>,
    { router: "/post/17", service },
  );
  await userEvent.click(screen.getByRole("button", { name: "Explain this post" }));
  // X opened its drawer: the engine then shows X's Grok page, as X's own full page button does.
  await expect.poll(() => inX).toEqual(["Grok actions", "go /i/grok"]);
  const drawer = screen.getByRole("region", { name: "Grok" });
  await expect
    .element(drawer.getByText("The post pairs a common rule with a twist."))
    .toBeVisible();
  await userEvent.click(drawer.getByRole("button", { name: "Close Grok" }));
  await expect.element(screen.getByRole("region", { name: "Grok" })).not.toBeInTheDocument();
});

it("puts Grok's answer into the draft it was opened beside only on Insert", async () => {
  at = "/i/grok";
  draw();
  const inserted: Array<string> = [];
  await using screen = await render(
    <div style={{ height: 800 }}>
      <GrokDrawer onInsert={(text) => inserted.push(text)} onClose={() => {}} />
    </div>,
    { router: "/compose", service },
  );
  await expect
    .element(screen.getByText("The post pairs a common rule with a twist."))
    .toBeVisible();
  expect(inserted).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(inserted).toEqual(["The post pairs a common rule with a twist."]);
});
