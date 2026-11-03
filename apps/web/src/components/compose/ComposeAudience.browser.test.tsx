import type { Draft } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import type { FakeService } from "../../../test/fakeService";

// Inside the desktop app with session actions on: Compose offers X's audience.
installFakeBridge();
const { draft, paid, rates, settings } = await import("../../../test/fixtures");
const { render } = await import("../../../test/render");
const { ComposeEditor } = await import("../../routes/compose");

const service = (drafts: ReadonlyArray<Draft>): FakeService => ({
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
  "compose.draftsList": () => Effect.succeed({ drafts }),
  "compose.quote": () => Effect.succeed({ articleUsd: 0.02, coverUsd: 0.04, coverModel: "flux" }),
  "compose.context": () =>
    Effect.succeed({ nextSlot: null, bestHours: [], desktopConnected: true }),
  "costs.quote": ({ actions }) =>
    Effect.succeed({ rates, quotes: actions.map(() => paid(0.00075)) }),
});

const editor = (id: string) => (
  <ComposeEditor
    draftParam={id}
    inspire={undefined}
    reply={undefined}
    text={undefined}
    onBack={() => {}}
    onSection={() => {}}
  />
);

it("offers no Community for a queued draft until it is unscheduled: its slot posts through the API", async () => {
  const blocks = [{ text: "ship it" }];
  const queued = draft("q1", "queued", { blocks, scheduledAt: "2030-01-07T09:30:00.000Z" });
  await using screen = await render(editor("q1"), { service: service([queued]) });
  await expect.element(screen.getByText("Unschedule to post it to a Community.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Choose audience" }).elements()).toHaveLength(0);

  await using open = await render(editor("d1"), {
    service: service([draft("d1", "draft", { blocks })]),
  });
  await expect.element(open.getByRole("button", { name: "Choose audience" })).toBeVisible();
});
