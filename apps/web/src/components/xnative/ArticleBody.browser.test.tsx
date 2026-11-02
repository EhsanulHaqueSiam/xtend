import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { ArticleBody } from "./ArticleBody";
import { synth } from "./engineFixtures";

it("draws an Article's blocks as X's reader does, and its links open outside", async () => {
  const bridge = installFakeBridge();
  const article = synth().article!.batches[0]!.articles![0]!;
  const extra = [
    // X counts offsets in code points: the emoji before "bold" is one, not two.
    {
      key: "x1",
      type: "unstyled",
      text: "Hi 🙂 bold",
      styles: [{ offset: 5, length: 4, style: "Bold" }],
    },
    // A block X's editor makes that Xtend does not know keeps its text, whatever X names it.
    { key: "x2", type: "constructor", text: "Kept as text", styles: [] },
  ].map((b) => ({ links: [], images: [], markdown: null, ...b }));
  await using screen = await render(<ArticleBody blocks={[...article.blocks, ...extra]} />, {
    service: {},
  });

  await expect.element(screen.getByRole("heading", { name: "What we tried" })).toBeVisible();
  const tag = (text: string) => screen.getByText(text, { exact: true }).element().tagName;
  expect([tag("free plan"), tag("bold"), tag("change")]).toEqual(["STRONG", "STRONG", "EM"]);
  const box = screen.container;
  expect([...box.querySelectorAll("ul, ol")].map((l) => [l.tagName, l.children.length])).toEqual([
    ["UL", 3],
    ["OL", 2],
  ]);
  // The chart, from the Article's own media.
  expect(box.querySelector("img")?.src).toBe(
    article.blocks.find((b) => b.images.length > 0)!.images[0]!.url,
  );
  expect(
    [...box.querySelector("table")!.rows].map((r) => [...r.cells].map((c) => c.textContent)),
  ).toEqual([
    ["Plan", "Price", "Signups"],
    ["Free", "$0", "412"],
    ["Pro", "$19", "97"],
  ]);
  // A fenced code block shows its code, not the fence.
  expect(box.querySelector("pre")?.textContent).toBe("const price = 19;");
  expect(box.textContent).toContain("Kept as text");

  await userEvent.click(screen.getByRole("link", { name: "our blog" }));
  expect(bridge.calls).toContain("external https://example.com/pricing");
});
