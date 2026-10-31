import { expect, it } from "vite-plus/test";

import { markXReady, registerXWebview, xAct, xGo, xNavigate, type XWebview } from "./x";

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

it("sends nothing to X's page for an id or handle that is not X's", async () => {
  const page = fakeWebview("https://x.com/home");
  registerXWebview(page.el);
  markXReady();
  expect(await xAct({ postId: '1"); alert(1); ("', handle: "theo" }, "like")).toBe(false);
  expect(await xAct({ postId: "42", handle: "a/b" }, "like")).toBe(false);
  expect(page.calls).toEqual([]);
});

it("waits for the guest before a page asked for early, so the step after it has a page", async () => {
  const cold = fakeWebview("https://x.com/home");
  registerXWebview(cold.el);
  let loaded = false;
  const home = xNavigate("https://x.com/home").then(() => (loaded = true));
  const search = xNavigate("https://x.com/search?q=a");
  await Promise.resolve();
  expect(loaded).toBe(false);
  markXReady();
  await Promise.all([home, search]);
  // The last ask wins; both callers waited for it.
  expect(cold.calls).toEqual(["load https://x.com/search?q=a"]);

  // The guest's first page is the one asked for: nothing loads twice.
  const same = fakeWebview("https://x.com/home");
  registerXWebview(same.el);
  const again = xNavigate("https://x.com/home");
  markXReady();
  await again;
  expect(same.calls).toEqual([]);
});

it("goes Back only from a post page it opened itself", async () => {
  // Already on the post: X's button is pressed on the second look, and the engine stays.
  const there = fakeWebview("https://x.com/theo/status/42", [false, true]);
  registerXWebview(there.el);
  markXReady();
  expect(await xAct({ postId: "42", handle: "theo" }, "like")).toBe(true);
  expect(there.calls).toHaveLength(2);
});
