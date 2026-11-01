import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";

// Inside the desktop app with session actions on: the only lane where text can post free.
// Everything that reads isElectron loads after the bridge exists.
installFakeBridge();
const { draft, quoting, settings } = await import("../../../test/fixtures");
const { render } = await import("../../../test/render");
const { Queue } = await import("./Queue");
const { Calendar } = await import("./Calendar");
const { postCosts } = await import("../compose/DraftsList");
const { ComposeEditor } = await import("../../routes/compose");
const { rates } = await import("../../../test/fixtures");
delete window.desktopBridge;

const service = {
  "costs.quote": quoting(),
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
};
const text = draft("d1", "queued", {
  blocks: [{ text: "Plain text post" }],
  scheduledAt: "2030-01-08T13:00:00.000Z",
});

it("prices Post now free through the session, but a slot fill at the API's price", async () => {
  {
    await using screen = await render(
      <Queue
        drafts={[text]}
        busy={false}
        emptyAction={null}
        onSkip={() => {}}
        onUnschedule={() => {}}
        onRunNow={() => {}}
        onRetry={() => {}}
        onDelete={() => {}}
        onOpen={() => {}}
      />,
      { service },
    );
    // Post now is a click, so it goes through the session: free.
    await expect.element(screen.getByText("free", { exact: true })).toBeVisible();
  }
  // A filled slot posts unattended at its time, through the API.
  await using screen = await render(
    <Calendar
      zone="UTC"
      start={new Date("2030-01-07T00:00:00.000Z")}
      now={new Date("2030-01-07T00:00:00.000Z")}
      slots={[{ id: 1, weekdayMask: 127, minuteOfDay: 13 * 60 }]}
      drafts={[]}
      heatmap={null}
      fillable={[{ ...text, status: "draft", scheduledAt: null }]}
      busy={false}
      onFill={() => {}}
      onOpen={() => {}}
    />,
    { service },
  );
  await userEvent.click(screen.getByRole("button", { name: "13:00 open slot" }).first());
  await expect.element(page.getByRole("menu").getByText("$0.015", { exact: true })).toBeVisible();
});

it("keeps a post with restricted replies on the API, as Publisher does, block by block", () => {
  const thread = [{ text: "open" }, { text: "closed", replySettings: "following" as const }];
  expect(postCosts(rates, thread, [], null, true)).toEqual([0, rates.post]);
  // The draft's own control applies where a block sets none.
  expect(
    postCosts(
      rates,
      [{ text: "a" }, { text: "b", replySettings: "everyone" }],
      [],
      null,
      true,
      "following",
    ),
  ).toEqual([rates.post, 0]);
  // Unattended, nothing but media goes through the session.
  expect(postCosts(rates, thread, [], null, false)).toEqual([rates.post, rates.post]);
});

it("prices the editor's Post now through the session, and Queue and Schedule at the API's rate", async () => {
  const d1 = draft("d1", "draft", { blocks: [{ text: "Plain text post" }] });
  await using _screen = await render(
    <ComposeEditor
      draftParam="d1"
      inspire={undefined}
      reply={undefined}
      text={undefined}
      onBack={() => {}}
      onSection={() => {}}
    />,
    {
      service: {
        ...service,
        "compose.draftsList": () => Effect.succeed({ drafts: [d1] }),
        "compose.quote": () =>
          Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
        "compose.context": () =>
          Effect.succeed({ nextSlot: null, bestHours: [], desktopConnected: true }),
      },
    },
  );
  // Button text as the user reads it (the morphing label repeats its word, so match loosely).
  const buttons = () => [...document.querySelectorAll("button")].map((b) => b.textContent ?? "");
  await expect.poll(() => buttons().find((t) => t.startsWith("Post now"))).toMatch(/free$/);
  await expect.poll(() => buttons().find((t) => t.startsWith("Queue"))).toMatch(/\$0\.015$/);
});
