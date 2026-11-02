import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";
import { PostAnalytics } from "./PostAnalytics";
import { Timeline } from "./Timeline";

const { home, analytics } = synth();
const [profile, activity] = analytics!.batches;
const yours = profile!.posts[0]!;

it("draws your post, then X's Post Analytics in X's order and words, without the Follows X counts", async () => {
  const bridge = installFakeBridge();
  await using screen = await render(
    <>
      <EngineSync />
      <PostAnalytics postId={yours.postId} onReopen={() => {}} />
    </>,
    { service: {} },
  );
  await expect.element(screen.getByText("Loading the post's analytics from X.")).toBeVisible();
  bridge.emitEngine(profile!);
  bridge.emitEngine(activity!);
  await expect.element(screen.getByText(yours.text)).toBeVisible();
  const drawn = () =>
    Array.from(screen.container.querySelectorAll("dl > div"), (d) => [
      d.querySelector("dt")?.textContent,
      d.querySelector("dd")?.textContent,
    ]);
  await expect.poll(drawn).toEqual([
    ["Impressions", "48,210"],
    ["Engagements", "1,380"],
    ["Detail expands", "214"],
    ["Profile visits", "96"],
    ["Link clicks", "0"],
  ]);
});

it("opens Post Analytics from your own post's views and X's ... row without pressing X, and others' views still open the post", async () => {
  const bridge = installFakeBridge();
  // X's "..." for your own post; any press of X's row would run a script that clicks it.
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve(
        code.includes("const labels") ? ["Delete", "View post analytics"] : false,
      );
    },
  } as unknown as XWebview);
  markXReady();
  try {
    await using screen = await render(
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <Timeline surface="following" header={null} empty="Loading" onReopen={() => {}} />
      </div>,
      { service: { "settings.get": () => Effect.succeed(settings) } },
    );
    const following = home!.batches.find((b) => b.op === "HomeLatestTimeline")!;
    const theirs = following.posts[0]!;
    bridge.emitEngine(home!.batches.find((b) => b.op === "Viewer")!);
    bridge.emitEngine({
      ...following,
      posts: [yours, theirs],
      order: [yours.postId, theirs.postId],
    });
    const [own, other] = [screen.getByRole("article").nth(0), screen.getByRole("article").nth(1)];
    const at = () => screen.router!.state.location.href;
    const analyticsHref = `/post/${yours.postId}/analytics?h=${yours.author.handle}`;

    await other.getByRole("button", { name: "Views", exact: true }).click();
    await expect.poll(at).toBe(`/post/${theirs.postId}?h=${theirs.author.handle}`);

    await own.getByRole("button", { name: "View post analytics" }).click();
    await expect.poll(at).toBe(analyticsHref);

    await screen.router!.navigate({ to: "/" });
    await own.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "View post analytics" }).click();
    await expect.poll(at).toBe(analyticsHref);
    expect(scripts.some((s) => s.includes("item.click()"))).toBe(false);
  } finally {
    registerXWebview(null);
  }
});
