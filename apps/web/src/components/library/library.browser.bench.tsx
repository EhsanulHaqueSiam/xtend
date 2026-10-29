import type { SavedPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import {
  DESKTOP,
  endlessAnimations,
  Refresh,
  SAMPLES,
  settled,
  timeMount,
} from "../../../test/bench";
import type { FakeService } from "../../../test/fakeService";
import { xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { swipeFileAtom } from "../../state/library";
import { SwipeTab } from "./SwipeTab";

const HOOK = "Nobody tells you this about building in public:";
const BODY =
  "the first 1,000 followers come from replies, not posts. Reply to ten people bigger than you every morning, say something specific, and leave before it turns into a thread.";

/** 100 saved posts of one to four paragraphs, so the masonry columns end at different heights. */
const saved = Array.from({ length: 100 }, (_, i): SavedPost => ({
  id: i + 1,
  post: xPost(
    String(1_980_000_000_000_000_000n + BigInt(i)),
    [HOOK, ...Array.from({ length: (i % 4) + 1 }, () => BODY)].join("\n\n"),
    {
      hasMedia: i % 5 === 0,
      metrics: {
        views: 10_000 + i * 977,
        likes: 300 + i,
        reposts: i % 50,
        replies: i % 30,
        quotes: i % 7,
        bookmarks: i % 90,
      },
    },
  ),
  note: i % 3 === 0 ? "steal the hook" : "",
  savedAt: "2026-10-20T12:00:00.000Z",
  collectionIds: [],
}));

const cards = (root: HTMLElement) => root.querySelectorAll("article");

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("Library swipe file with 100 cards", async ({ bench }) => {
  let listed = saved;
  let refresh = () => {};
  const service: FakeService = { "library.savedList": () => Effect.sync(() => listed) };
  const ui = (
    <>
      <SwipeTab />
      <Refresh atom={swipeFileAtom("")} bind={(r) => (refresh = r)} />
    </>
  );
  const all = (root: HTMLElement) => cards(root).length === saved.length;

  const mount = await bench("Library: mount 100 cards", timeMount(ui, { service }, all)).run(
    SAMPLES,
  );
  expect(mount.latency.p50).toBeLessThan(250); // 27ms

  await using screen = await render(ui, { service });
  await settled(screen.container, () => all(screen.container));
  expect(endlessAnimations()).toEqual([]);

  // A note saved from the inspector refetches the swipe file.
  let version = 0;
  const update = await bench("Library: one card changes", async () => {
    version += 1;
    const note = `note ${version}`;
    listed = saved.with(0, { ...saved[0]!, note });
    refresh();
    await settled(
      screen.container,
      () => cards(screen.container)[0]?.textContent.includes(note) === true,
    );
  }).run(SAMPLES);
  expect(update.latency.p50).toBeLessThan(60); // 5ms
});
