import type { TextStyle } from "@xtend/contracts";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { StyledArea } from "./FormatTools";

// Tests load no CSS: the layout classes the layer stands on, as Tailwind writes them.
const css = document.createElement("style");
css.textContent =
  ".relative{position:relative}.absolute{position:absolute}.inset-0{inset:0}.overflow-hidden{overflow:hidden}.whitespace-pre-wrap{white-space:pre-wrap}.break-words{overflow-wrap:break-word}.inline-block{display:inline-block}.italic{font-style:italic}";
document.head.append(css);

const FONT = "20px/24px sans-serif";
const AREA = { font: "inherit", padding: 0, border: 0, width: "100%", resize: "none" } as const;

const layerOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[aria-hidden]")!;

it("keeps a word whole where an italic run ends inside it, wrapping where the textarea does", async () => {
  const width = (text: string) => {
    const probe = document.createElement("span");
    probe.style.font = FONT;
    probe.textContent = text;
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  // Room for "hello wonder" but not "hello wonderful": the textarea moves the whole word down.
  const short = width("hello wonder");
  const room = short + 0.3 * (width("hello wonderful") - short);
  const styles: ReadonlyArray<TextStyle> = [{ start: 6, end: 12, style: "Italic" }];
  await using screen = await render(
    <div style={{ font: FONT, width: room }}>
      <StyledArea value="hello wonderful today" readOnly styles={styles} font="" style={AREA} />
    </div>,
    { service: {} },
  );
  const run = layerOf(screen.container).querySelector("span")!;
  const rest = document.createRange();
  rest.setStart(run.nextSibling!, 0);
  rest.setEnd(run.nextSibling!, 3);
  // "wonder" and "ful" on one line, as the textarea's own text is.
  expect(rest.getBoundingClientRect().top).toBe(run.getBoundingClientRect().top);
});

it("starts the layer where a textarea already scrolled is, when formatting begins", async () => {
  function Box() {
    const [styles, setStyles] = useState<ReadonlyArray<TextStyle>>([]);
    return (
      <div style={{ font: FONT, width: 300 }}>
        <button type="button" onClick={() => setStyles([{ start: 0, end: 4, style: "Bold" }])}>
          Bold
        </button>
        <StyledArea
          aria-label="Post text"
          value={"line\n".repeat(20)}
          readOnly
          styles={styles}
          font=""
          style={{ ...AREA, height: 48 }}
        />
      </div>
    );
  }
  await using screen = await render(<Box />, { service: {} });
  const area = screen.getByLabelText("Post text").element() as HTMLTextAreaElement;
  area.scrollTop = 120;
  await userEvent.click(screen.getByRole("button", { name: "Bold" }));
  expect(layerOf(screen.container).scrollTop).toBe(area.scrollTop);
});
