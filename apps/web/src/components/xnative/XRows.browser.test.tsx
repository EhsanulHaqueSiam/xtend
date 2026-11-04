import { useState } from "react";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { useMore } from "./XRows";

/** A column `tall` px high in a 400 px window, and a button that plays the list reaching its end. */
function Column({ tall, high = 400 }: { readonly tall: number; readonly high?: number }) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const more = useMore(scroller, "search", 20);
  return (
    <>
      <div ref={setScroller} style={{ height: high, overflowY: "auto" }}>
        <div style={{ height: tall }} />
      </div>
      <button type="button" onClick={more}>
        end reached
      </button>
    </>
  );
}

it("asks X for more at the list's end only while the column has nothing to scroll, never on its own past that", async () => {
  const asks: Array<string> = [];
  registerXWebview({
    loadURL: async () => {},
    getURL: () => "https://x.com/search?q=a",
    executeJavaScript: (code: string) => (
      code.includes("__xtendScroll") && asks.push(code),
      Promise.resolve(false)
    ),
  } as unknown as XWebview);
  markXReady();
  try {
    // A list past the screen: reaching its end with no scroll of the reader's asks nothing.
    {
      await using screen = await render(<Column tall={3000} />, { service: {} });
      await screen.getByRole("button", { name: "end reached" }).click();
      await screen.getByRole("button", { name: "end reached" }).click();
      expect(asks).toEqual([]);
    }
    // The window grows past the list: the end held back asks now, as nothing is left to scroll.
    {
      await using screen = await render(<Column tall={3000} />, { service: {} });
      await screen.getByRole("button", { name: "end reached" }).click();
      expect(asks).toEqual([]);
      await screen.rerender(<Column tall={3000} high={4000} />);
      await expect.poll(() => asks.length).toBe(1);
      asks.length = 0;
    }
    // A short list, with nothing to scroll, asks so X fills the screen.
    await using screen = await render(<Column tall={100} />, { service: {} });
    await screen.getByRole("button", { name: "end reached" }).click();
    await expect.poll(() => asks.length).toBe(1);
  } finally {
    registerXWebview(null);
  }
});
