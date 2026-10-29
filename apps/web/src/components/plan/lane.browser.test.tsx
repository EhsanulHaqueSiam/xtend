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
