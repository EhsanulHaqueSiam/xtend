import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";

import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XMenuOutcome } from "../../state/x";
import { Toasts } from "../ui/toast";
import { useXPress } from "./useXPress";

it("takes away an earlier press's Undo once another press starts", async () => {
  let finish: (o: XMenuOutcome) => void = () => {};
  const second = new Promise<XMenuOutcome>((resolve) => (finish = resolve));
  const done = (toast: string): XMenuOutcome => ({
    kind: "done",
    toast,
    undo: true,
    gone: true,
    current: true,
  });
  function Rows() {
    const { pressRow } = useXPress();
    return (
      <>
        <button type="button" onClick={() => void pressRow(async () => done("A hidden"))}>
          A
        </button>
        <button type="button" onClick={() => void pressRow(() => second)}>
          B
        </button>
      </>
    );
  }
  await using screen = await render(
    <>
      <Rows />
      <Toasts />
    </>,
    {
      service: {
        "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
      },
    },
  );
  await screen.getByRole("button", { name: "A", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "B", exact: true }).click();
  // Checked at once, not polled: the toast also leaves on its own a few seconds later.
  expect(screen.getByRole("button", { name: "Undo", exact: true }).elements()).toHaveLength(0);
  finish(done("B hidden"));
  await expect.element(screen.getByRole("status")).toHaveTextContent("B hiddenUndo");
});
