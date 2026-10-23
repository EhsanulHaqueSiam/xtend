import type { DraftMedia } from "@xtend/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { QuoteCard, quotedPostId } from "./PostPreview";
import { charCount, MediaList, splitBlocks, ThreadEditor } from "./ThreadEditor";

it("counts links as 23 characters, splits pasted paragraphs, reads quote links", () => {
  expect(charCount("hello")).toBe(5);
  expect(charCount("see https://example.com/a/very/long/path/that/goes/on")).toBe(4 + 23);
  expect(splitBlocks("one\n\ntwo\n \nthree")).toEqual(["one", "two", "three"]);
  expect(quotedPostId("https://x.com/levelsio/status/1234?s=20")).toBe("1234");
  expect(quotedPostId("https://example.com/levelsio/status/1234")).toBeNull();
});

it("shows the count per block and splits pasted text into blocks", async () => {
  const onChange = vi.fn();
  await using screen = await render(
    <ThreadEditor
      blocks={[{ text: "x".repeat(281) }, { text: "" }]}
      media={[]}
      previews={{}}
      active={0}
      avatar="S"
      onChange={onChange}
      onFocus={() => {}}
      onAddFiles={() => {}}
      onMediaChange={() => {}}
      onRemoveMedia={() => {}}
    />,
  );
  // The post being written shows X's remaining count; the over-limit one goes negative.
  await expect.element(screen.getByLabelText("Characters left")).toHaveTextContent("-1");

  // The browser's own paste needs clipboard permission; a synthetic event carries the same data.
  const data = new DataTransfer();
  data.setData("text/plain", "first\n\nsecond");
  screen
    .getByLabelText("Post 2")
    .element()
    .dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  expect(onChange).toHaveBeenLastCalledWith([
    { text: "x".repeat(281) },
    { text: "first" },
    { text: "second" },
  ]);
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
