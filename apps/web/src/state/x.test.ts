import { expect, it } from "vite-plus/test";

import { markXReady, registerXWebview, xAct, xGo, type XWebview } from "./x";

/** A webview that records what it was asked to do, showing `url`; scripts answer `answers` in turn. */
const fakeWebview = (url: string, answers: Array<unknown> = []) => {
  const calls: Array<string> = [];
  const el = {
    loadURL: async (u: string) => void calls.push(`load ${u}`),
    executeJavaScript: async (code: string) => (
      calls.push(`run ${code.slice(0, 41)}`),
      answers.shift()
    ),
    getURL: () => url,
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  // The engine steps under test touch only these three of the element's methods.
  return { el: el as unknown as XWebview, calls };
};

it("moves within x.com through X's router, and loads anything it cannot", async () => {
  const onX = fakeWebview("https://x.com/home");
  registerXWebview(onX.el);
  markXReady();
  await xGo("https://x.com/theo/media");
  await xGo("https://x.com/home");
  await xGo("https://example.com/");
  expect(onX.calls).toEqual(['run history.pushState(null, "", "/theo/media"']);

  // X's login flow is not a page its router can leave for a signed-in one.
  const signingIn = fakeWebview("https://x.com/i/flow/login");
  registerXWebview(signingIn.el);
  markXReady();
  await xGo("https://x.com/home");
  expect(signingIn.calls).toEqual(["load https://x.com/home"]);
});

it("presses X's button in place, or on the post's page and then back to the list", async () => {
  const held = fakeWebview("https://x.com/home", [true]);
  registerXWebview(held.el);
  markXReady();
  expect(await xAct({ postId: "42", handle: "theo" }, "bookmark")).toBe(true);
  expect(held.calls).toHaveLength(1);

  // Not on the page: X's router to the post, the press there, then Back.
  const gone = fakeWebview("https://x.com/home", [false, true, true, true]);
  registerXWebview(gone.el);
  markXReady();
  expect(await xAct({ postId: "42", handle: "theo" }, "like")).toBe(true);
  expect(gone.calls.slice(1).map((c) => c.slice(4, 22))).toEqual([
    "history.pushState(",
    "(async () => {\n   ",
    "location.pathname.",
  ]);
});
