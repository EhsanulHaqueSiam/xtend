import "../../index.css";
import { useAtomSet } from "@effect/atom-react";
import type { GrokCapture } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";

// The screen reads the bridge at module load (env.ts), so it is imported after it exists.
installFakeBridge();
// X's older client's traffic, as the capture hands it to the window.
const listeners = new Set<(capture: GrokCapture) => void>();
Reflect.set(window.desktopBridge!, "onGrok", (cb: (capture: GrokCapture) => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
});
const hear = (capture: GrokCapture) => {
  for (const cb of listeners) cb(capture);
};
const { GrokLegacy } = await import("./GrokLegacy");
const { markXReady, registerXWebview, xUrlAtom } = await import("../../state/x");

// X's older Grok page (bundle.Grok) as the engine holds it: its box and Send, nothing to read.
document.body.insertAdjacentHTML(
  "beforeend",
  `<div id="x"><main><div data-testid="primaryColumn"><textarea placeholder="Ask anything"></textarea><button aria-label="Grok something">↑</button></div></main></div>`,
);
const pressed: Array<string> = [];
const field = document.querySelector<HTMLTextAreaElement>("#x textarea")!;
document.querySelector("#x button")!.addEventListener("click", () => {
  pressed.push(`sent ${field.value}`);
  field.value = "";
});
registerXWebview({
  loadURL: async () => {},
  getURL: () => "https://x.com/i/grok?conversation=c1",
  executeJavaScript: (code: string) =>
    Promise.resolve(new Function(`return ${code.replaceAll("location.pathname", '"/i/grok"')}`)()),
} as unknown as XWebview);
markXReady();

function Screen() {
  const setUrl = useAtomSet(xUrlAtom);
  return (
    <div style={{ height: 700, display: "flex", flexDirection: "column" }}>
      <button type="button" onClick={() => setUrl("https://x.com/i/grok?conversation=c1")}>
        On c1
      </button>
      <GrokLegacy />
    </div>
  );
}

it("draws X's older client's conversation from X's own answers, streams its answer, and sends through X's own box", async () => {
  await using screen = await render(<Screen />, {
    router: "/grok",
    service: { "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }) },
  });
  await userEvent.click(screen.getByRole("button", { name: "On c1" }));
  hear({
    kind: "graphql",
    op: "GrokConversationItemsByRestId",
    variables: { restId: "c1" },
    body: {
      data: {
        grok_conversation_items_by_rest_id: {
          items: [
            { chat_item_id: "a1", sender_type: "Agent", message: "**Two** camps." },
            { chat_item_id: "u1", sender_type: "User", message: "Who argues what?" },
          ],
        },
      },
    },
  });
  await expect.element(screen.getByText("Who argues what?")).toBeVisible();
  await expect.element(screen.getByText("Two")).toBeVisible();

  await userEvent.fill(screen.getByRole("textbox", { name: "Ask Grok" }), "And who is right?");
  expect(pressed).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await expect.poll(() => pressed).toEqual(["sent And who is right?"]);

  // X's answer, line by line as it streams: each word shows as it comes.
  const line = (value: unknown) =>
    hear({ kind: "chunk", stream: "s", line: JSON.stringify(value) });
  line({ conversationId: "c1" });
  line({ result: { message: "Neither, " } });
  await expect.element(screen.getByText("Neither,")).toBeVisible();
  line({ result: { message: "it depends." } });
  await expect.element(screen.getByText("Neither, it depends.")).toBeVisible();
  hear({ kind: "end", stream: "s" });
});
