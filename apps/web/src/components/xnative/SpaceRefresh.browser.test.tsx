import type { EnginePost } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import {
  markXReady,
  refreshScreen,
  registerXWebview,
  xKeepPage,
  xNavigate,
  type XWebview,
} from "../../state/x";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";
import { Timeline } from "./Timeline";

const following = synth().home!.batches.find((b) => b.op === "HomeLatestTimeline")!;
const first: EnginePost = following.posts[0]!;

it("refreshes while X plays a Space through X's own nav link, keeping the list it has, never a full load", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/home",
    loadURL: (url: string) => (scripts.push(`load ${url}`), Promise.resolve()),
  } as unknown as XWebview);
  markXReady();
  xKeepPage(true);
  try {
    await using screen = await render(
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <Timeline
          surface="following"
          header={null}
          empty="Loading"
          onReopen={() => void xNavigate("https://x.com/home")}
        />
      </div>,
      { service: {} },
    );
    bridge.emitEngine(following);
    await expect.element(screen.getByText(first.text)).toBeVisible();
    refreshScreen();
    // A full load would end the Space: X's own Home link refreshes Home, and the list stays.
    await expect
      .poll(() => scripts.some((s) => s.includes('AppTabBar_\\"][href=\\"/home')))
      .toBe(true);
    expect(scripts.some((s) => s.startsWith("load "))).toBe(false);
    await expect.element(screen.getByText(first.text)).toBeVisible();
  } finally {
    xKeepPage(false);
    registerXWebview(null);
  }
});
