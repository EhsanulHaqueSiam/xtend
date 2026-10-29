import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { DESKTOP, endlessAnimations, SAMPLES, settled, timeMount } from "../../../test/bench";
import type { FakeService } from "../../../test/fakeService";
import { draft, quoting, settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { ComposeEditor } from "../../routes/compose";

/** A 10-post thread of tweet-sized posts. */
const thread = draft("d1", "draft", {
  blocks: Array.from({ length: 10 }, (_, i) => ({
    text: `${i + 1}/ The pricing page converted 3x better once it showed proof instead of features: logos, numbers, one real quote.`,
  })),
});

const service: FakeService = {
  "settings.get": () => Effect.succeed(settings),
  "compose.draftsList": () => Effect.succeed({ drafts: [thread] }),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
  "compose.context": () =>
    Effect.succeed({ nextSlot: null, bestHours: [], desktopConnected: true }),
  "costs.quote": quoting(),
  // Autosave runs once typing pauses, and on unmount.
  "compose.draftUpdate": ({ id, patch }) =>
    Effect.succeed(draft(id, "draft", { blocks: patch.blocks ?? thread.blocks })),
};

const ui = (
  <ComposeEditor
    draftParam="d1"
    inspire={undefined}
    reply={undefined}
    text={undefined}
    onBack={() => {}}
    onSection={() => {}}
  />
);

const posts = (root: HTMLElement) => root.querySelectorAll("textarea");

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("Compose with a 10-post thread", async ({ bench }) => {
  // The editor opens empty, then fills in the draft once the list has it.
  const all = (root: HTMLElement) => posts(root).length === thread.blocks.length;

  const mount = await bench("Compose: open a 10-post thread", timeMount(ui, { service }, all)).run(
    SAMPLES,
  );
  expect(mount.latency.p50).toBeLessThan(60); // 6ms

  await using screen = await render(ui, { service });
  await settled(screen.container, () => all(screen.container));
  expect(endlessAnimations()).toEqual([]);

  const post = posts(screen.container)[4]!;
  // The "41/280" under the post: it moves only once React has rendered the keystroke.
  const count = post.parentElement!.querySelector('[aria-label="Characters used"]')!;
  const typed = post.value.length;
  post.focus();
  post.setSelectionRange(typed, typed);

  // Typed in the page rather than through Playwright, whose round trip per key would dwarf the
  // render. insertText fires the same beforeinput and input events a real key does.
  const keystroke = await bench("Compose: one keystroke", async () => {
    document.execCommand("insertText", false, "a");
    await settled(screen.container, () => count.textContent === `${post.value.length}/280`);
  }).run({ ...SAMPLES, iterations: 50 });
  // Keystrokes that never landed would time nothing and still pass.
  expect(post.value.length).toBeGreaterThanOrEqual(typed + 50);
  // One frame at 60 Hz: past it, typing visibly lags.
  expect(keystroke.latency.p50).toBeLessThan(16); // 1ms
});
