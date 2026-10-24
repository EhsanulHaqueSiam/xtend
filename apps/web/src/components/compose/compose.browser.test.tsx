import type { DraftMedia } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { FakeService } from "../../../test/fakeService";
import { paid, rates } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { AssistPanel } from "./AssistPanel";
import { QuoteCard, quotedPostId } from "./PostPreview";
import { charCount, MediaList, postText, splitBlocks, ThreadEditor } from "./ThreadEditor";

it("counts links as 23 characters, splits pasted paragraphs, reads quote links", () => {
  expect(charCount("hello")).toBe(5);
  expect(charCount("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
  expect(splitBlocks("one\n\ntwo\n \nthree")).toEqual(["one", "two", "three"]);
  expect(quotedPostId("https://x.com/levelsio/status/1234?s=20")).toBe("1234");
  expect(quotedPostId("https://example.com/levelsio/status/1234")).toBeNull();
});

it("weighs text as X does against 280", () => {
  // CJK and other heavy scripts count 2 a character.
  expect(charCount("日本語")).toBe(6);
  // An emoji counts 2 however many code points it joins.
  expect(charCount("👍")).toBe(2);
  expect(charCount("👨‍👩‍👧")).toBe(2);
  expect(charCount("🇧🇩")).toBe(2);
  expect(charCount("❤️")).toBe(2);
  // An accent typed as a combining mark is one character once composed.
  expect(charCount("café")).toBe(4);
  // The quote link rides on the first post only, after a line break.
  const quote = "https://x.com/levelsio/status/1234";
  expect(charCount(postText("hi", 0, quote))).toBe(2 + 1 + 23);
  expect(charCount(postText("hi", 1, quote))).toBe(2);
});

const editorProps = {
  media: [],
  previews: {},
  quoteUrl: null,
  active: 0,
  avatar: "S",
  onFocus: () => {},
  onAddFiles: () => {},
  onMediaChange: () => {},
  onRemoveMedia: () => {},
} as const;

const paste = (target: HTMLElement, text: string) => {
  // The browser's own paste needs clipboard permission; a synthetic event carries the same data.
  const data = new DataTransfer();
  data.setData("text/plain", text);
  target.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
  );
};

it("shows the count per block, with the quote link on the first, and splits pasted text into blocks", async () => {
  const onChange = vi.fn();
  await using screen = await render(
    <ThreadEditor
      {...editorProps}
      blocks={[{ text: "x".repeat(281) }, { text: "" }]}
      onChange={onChange}
    />,
  );
  // The post being written shows X's remaining count; the over-limit one goes negative.
  await expect.element(screen.getByLabelText("Characters left")).toHaveTextContent("-1");

  paste(screen.getByLabelText("Post 2").element() as HTMLElement, "first\n\nsecond");
  expect(onChange).toHaveBeenLastCalledWith([
    { text: "x".repeat(281) },
    { text: "first" },
    { text: "second" },
  ]);

  await screen.rerender(
    <ThreadEditor
      {...editorProps}
      blocks={[{ text: "x".repeat(260) }]}
      quoteUrl="https://x.com/levelsio/status/1234"
      onChange={onChange}
    />,
  );
  await expect.element(screen.getByLabelText("Characters left")).toHaveTextContent("-4");
});

it("keeps a post's own text around a pasted thread and moves later posts' media with them", async () => {
  const onChange = vi.fn();
  const onMediaChange = vi.fn();
  const later: DraftMedia = {
    id: "m",
    blockIndex: 1,
    path: "/m/cat.png",
    kind: "image",
    alt: "",
    position: 0,
  };
  await using screen = await render(
    <ThreadEditor
      {...editorProps}
      blocks={[{ text: "abcdef", replySettings: "following" }, { text: "next" }]}
      media={[later]}
      onChange={onChange}
      onMediaChange={onMediaChange}
    />,
  );
  const first = screen.getByLabelText("Post 1").element() as HTMLTextAreaElement;
  first.setSelectionRange(3, 3);
  paste(first, "one\n\ntwo");
  expect(onChange).toHaveBeenLastCalledWith([
    { text: "abcone", replySettings: "following" },
    { text: "twodef" },
    { text: "next" },
  ]);
  expect(onMediaChange).toHaveBeenLastCalledWith([{ ...later, blockIndex: 2 }]);
});

it("lists a block's media with alt text and removes one", async () => {
  const media: ReadonlyArray<DraftMedia> = [
    { id: "a", blockIndex: 0, path: "/m/cat.png", kind: "image", alt: "", position: 0 },
    { id: "b", blockIndex: 0, path: "/m/clip.mp4", kind: "video", alt: "", position: 1 },
  ];
  const onChange = vi.fn();
  const onRemove = vi.fn();
  await using screen = await render(
    <MediaList media={media} previews={{}} onChange={onChange} onRemove={onRemove} />,
  );
  await expect.element(screen.getByText("cat.png")).toBeVisible();
  await expect.element(screen.getByText("clip.mp4")).toBeVisible();
  // Only images carry alt text.
  expect(screen.getByLabelText("Alt text").elements()).toHaveLength(1);
  await userEvent.fill(screen.getByLabelText("Alt text"), "a cat");
  expect(onChange).toHaveBeenLastCalledWith([{ ...media[0], alt: "a cat" }, media[1]]);
  await userEvent.click(screen.getByRole("button", { name: "Remove media" }).first());
  expect(onRemove).toHaveBeenCalledWith("a");
});

it("renders an unsaved quote as the bare link X will receive", async () => {
  await using screen = await render(<QuoteCard url="https://x.com/levelsio/status/99" />, {
    router: false,
  });
  await expect
    .element(screen.getByTestId("quote-link"))
    .toHaveTextContent("https://x.com/levelsio/status/99");
});

it("prices every assist action before it runs, voice match with its read of the handle's posts", async () => {
  const quoted: Array<string> = [];
  const panel = (handle: string | null) => (
    <AssistPanel
      handle={handle}
      blocks={["Three things I got wrong"]}
      active={0}
      onReplaceBlock={() => {}}
      onAppend={() => {}}
      onReplaceAll={() => {}}
    />
  );
  const service: FakeService = {
    "costs.quote": ({ actions }) => {
      quoted.push(...actions.map((a) => a.kind));
      return Effect.succeed({ rates, quotes: actions.map(() => paid(0.00075)) });
    },
  };
  {
    await using screen = await render(panel("siamships"), { service });
    await expect
      .element(screen.getByRole("button", { name: "Voice match · $0.00075 + model" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Improve hook · model" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Rewrite · model" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Continue thread · model" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Ideas · model" })).toBeVisible();
  }
  quoted.length = 0;
  // Without a handle voice match reads nothing from X.
  await using screen = await render(panel(null), { service });
  await expect.element(screen.getByRole("button", { name: "Voice match · model" })).toBeVisible();
  expect(quoted).toEqual([]);
});
