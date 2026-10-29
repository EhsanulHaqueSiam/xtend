import type { Mention } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { beforeAll, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { DESKTOP, endlessAnimations, SAMPLES, settled, timeMount } from "../../../test/bench";
import type { FakeService } from "../../../test/fakeService";
import { liveEvents, quoting, settings, xPost } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { Mentions } from "./Mentions";

const START = Date.parse("2026-10-28T12:00:00.000Z");

/** 200 open mentions, newest first, from 200 authors. */
const mentions = Array.from({ length: 200 }, (_, i): Mention => ({
  post: xPost(
    String(1_980_000_000_000_000_000n + BigInt(i)),
    `@siamships ${i}: how did you price the first plan? Asking before our launch next week`,
    {
      createdAt: new Date(START - i * 1_800_000).toISOString(),
      isReply: true,
      author: {
        userId: String(5_000 + i),
        handle: `builder${i}`,
        name: `Builder ${i}`,
        followers: (i * 7_919) % 60_000,
        verified: i % 9 === 0,
        avatarUrl: null,
      },
      metrics: {
        views: 50 + ((i * 131) % 5_000),
        likes: i % 40,
        reposts: i % 3,
        replies: i % 7,
        quotes: 0,
        bookmarks: i % 4,
      },
    },
  ),
  source: i % 4 === 0 ? "api" : "session",
  handled: false,
}));

const rows = (root: HTMLElement) => root.querySelectorAll("button[data-selected]");

beforeAll(() => page.viewport(DESKTOP.width, DESKTOP.height));

it("Engage Mentions with 200 mentions", async ({ bench }) => {
  let listed = mentions;
  const service: FakeService = {
    "settings.get": () => Effect.succeed(settings),
    "costs.quote": quoting(),
    "engage.mentions": () => Effect.sync(() => ({ mentions: listed, apiError: null })),
    // The open mention's panel mounts the inbox. An rpc left unanswered here dies, and with it
    // the fake's live events, so the refetch below would never come.
    "engage.inbox": () => Effect.succeed({ sent: [], followUps: [], incoming: [] }),
  };
  const all = (root: HTMLElement) => rows(root).length === mentions.length;

  const mount = await bench("Mentions: mount 200", timeMount(<Mentions />, { service }, all)).run(
    SAMPLES,
  );
  expect(mount.latency.p50).toBeLessThan(120); // 11ms

  // Only this screen listens: two subscribers would take turns at the one queue.
  const events = liveEvents();
  await using screen = await render(<Mentions />, {
    service: { ...service, "events.subscribe": events.subscribe },
  });
  await settled(screen.container, () => all(screen.container));
  expect(endlessAnimations()).toEqual([]);

  // A mention arriving from the session refetches the list; here it edits the newest one.
  let version = 0;
  const update = await bench("Mentions: one row changes", async () => {
    version += 1;
    const text = `edited ${version}`;
    listed = mentions.with(0, { ...mentions[0]!, post: { ...mentions[0]!.post, text } });
    events.emit("mention_arrived");
    await settled(
      screen.container,
      () => rows(screen.container)[0]?.textContent.includes(text) === true,
    );
  }).run(SAMPLES);
  expect(update.latency.p50).toBeLessThan(60); // 5.5ms
});
