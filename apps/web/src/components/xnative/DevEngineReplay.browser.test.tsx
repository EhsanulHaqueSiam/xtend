import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { DevEngineReplay } from "./DevEngineReplay";
import { Timeline } from "./Timeline";

it("replays ?engine= into the store, so a native list draws the fixture's posts without a desktop", async () => {
  await using screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <DevEngineReplay asked="home" />
      <Timeline surface="following" header={null} empty="Loading" onReopen={() => {}} />
    </div>,
    { service: {} },
  );
  await expect
    .element(
      screen.getByText("The best growth hack is still answering every reply for the first year."),
    )
    .toBeVisible();
  expect(window.xtendDev?.fixtures()).toContain("post");
  await expect(window.xtendDev!.replay("nope")).rejects.toThrow('No engine fixture "nope"');
});
