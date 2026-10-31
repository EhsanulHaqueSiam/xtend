import { expect, it } from "vite-plus/test";

import { markXReady, registerXWebview, xActInPlace, type XWebview } from "./x";

// X's page as the engine holds it: a post quoting 42, then 42 itself, edited, so its timestamp
// links to its edit history.
const X_PAGE = `
  <article id="quote"><a href="/ann/status/7"><time></time></a><a href="/theo/status/42">quoted</a>
    <button data-testid="bookmark"></button></article>
  <article id="edited"><a href="/theo/status/42/history"><time></time></a>
    <button data-testid="bookmark"></button></article>`;

it("presses X's button on the post's own article, edited or not, never on a post quoting it", async () => {
  document.body.innerHTML = X_PAGE;
  const pressed: Array<string> = [];
  // X turns a pressed button over to its undo.
  for (const b of document.querySelectorAll("button"))
    b.addEventListener("click", () => {
      pressed.push(b.closest("article")!.id);
      b.dataset.testid = "removeBookmark";
    });
  // The engine's scripts run in X's page; here, in this document.
  const el = {
    loadURL: async () => {},
    getURL: () => "https://x.com/home",
    // oxlint-disable-next-line no-implied-eval -- the script under test is the one sent to X's page
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  registerXWebview(el as unknown as XWebview);
  markXReady();

  expect(await xActInPlace("42", "bookmark")).toBe(true);
  expect(pressed).toEqual(["edited"]);
});
