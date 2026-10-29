import { expect, it } from "vite-plus/test";

import { emptyPanel, panelHtml } from "./replyPanel.ts";

const mount = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

it("leads with Write my own, lists the drafts as A, B, C, and sends free through the session", () => {
  const el = mount(
    panelHtml({
      ...emptyPanel,
      tone: "ask",
      drafts: ["One?", "Two?", "<b>Three</b>?"],
      text: "Two?",
    }),
  );
  const chips = [...el.querySelectorAll(".tones .chip")].map((b) => b.textContent);
  expect(chips[0]).toBe("Write my own");
  expect(chips).toContain("Ask");
  expect(el.querySelector('.chip[data-tone="ask"]')?.getAttribute("aria-pressed")).toBe("true");
  const drafts = [...el.querySelectorAll(".draft")];
  expect(drafts.map((d) => d.querySelector(".n")?.textContent)).toEqual(["A", "B", "C"]);
  expect(drafts[1]?.getAttribute("aria-pressed")).toBe("true");
  // Post text is markup-safe.
  expect(drafts[2]?.querySelector("b")).toBeNull();
  expect(el.querySelector(".send")?.textContent).toBe("Replyfree · your session");
  expect(el.querySelector("textarea")?.value).toBe("Two?");
});

it("locks every control while a draft or reply is in flight, and after a reply", () => {
  const busy = mount(panelHtml({ ...emptyPanel, tone: "warm", busy: "draft" }));
  expect(busy.querySelector('.chip[data-tone="warm"]')?.textContent).toBe("Drafting…");
  expect(busy.querySelectorAll(".tones .chip:not([disabled])")).toHaveLength(0);
  const done = mount(panelHtml({ ...emptyPanel, text: "ok", replied: true }));
  expect(done.querySelector(".send")?.textContent).toBe("Replied");
  expect(done.querySelector("textarea")?.disabled).toBe(true);
});
