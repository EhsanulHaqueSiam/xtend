import "../../index.css";
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";

// The screen reads the bridge at module load (env.ts), so it is imported after the bridge exists.
installFakeBridge();
const { SettingsScreen } = await import("../../routes/settings");
const { markXReady, registerXWebview, xOverAtom } = await import("../../state/x");
const { xPageBarAtom } = await import("../../state/xSettings");

// X's Audience and tagging page as its components draw it (SettingsRevamp): its header, then a
// <label> checkbox with its help, then a link row.
const AUDIENCE = `<main role="main"><section aria-labelledby="detail-header"><div><div><button data-testid="app-bar-back" aria-label="Back"></button></div><div><h2 id="detail-header" role="heading" aria-level="2"><span>Audience, media and tagging</span></h2><div><span>@you</span></div></div></div><div>
  <label><div><div dir="ltr"><span>Protect your posts</span></div><div><input type="checkbox"></div></div><div dir="ltr"><span>When selected, your posts are only visible to people who follow you.</span></div></label>
  <a href="/settings/tagging" role="tab"><div><div dir="ltr"><span>Photo tagging</span></div><div dir="ltr"><span>Anyone can tag you</span></div></div></a>
</div></section></main>`;
const x = document.createElement("div");
document.body.append(x);

/** The engine: X's router moves are recorded; every other script runs in this document as X's page. */
const moves: Array<string> = [];
registerXWebview({
  loadURL: async () => {},
  getURL: () => `https://x.com${moves.at(-1) ?? "/home"}`,
  executeJavaScript: (code: string) => {
    const to = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
    if (to !== undefined) return Promise.resolve(void moves.push(to) ?? true);
    return Promise.resolve(
      new Function(
        `return ${code.replaceAll("location.pathname", JSON.stringify(moves.at(-1) ?? "/home"))}`,
      )(),
    );
  },
} as unknown as XWebview);
markXReady();

function Probe() {
  const bar = useAtomValue(xPageBarAtom);
  const search = useLocation({ select: (l) => l.searchStr });
  return (
    <p data-testid="probe">
      {`over ${String(useAtomValue(xOverAtom))} bar ${bar?.title ?? "none"} at ${search}`}
    </p>
  );
}
const ui = (
  <div style={{ height: 700 }}>
    <Probe />
    <SettingsScreen />
  </div>
);
const probe = () => document.querySelector('[data-testid="probe"]')?.textContent ?? "";
const service = { "accounts.list": () => Effect.succeed({ accounts: [], currentId: 1 }) };

it("finds X's settings in Settings search beside Xtend's, and draws the one picked from X's page, pressing X's own checkbox", async () => {
  x.innerHTML = AUDIENCE;
  const pressed: Array<boolean> = [];
  x.querySelector("input")!.addEventListener("change", (e) =>
    pressed.push((e.target as HTMLInputElement).checked),
  );
  await using screen = await render(ui, { router: "/settings?tab=money", service });
  await userEvent.fill(screen.getByRole("searchbox", { name: "Search settings" }), "protect");
  await userEvent.click(
    screen.getByRole("button", { name: /Protect your posts.*X › Privacy and safety/ }),
  );

  await expect.poll(probe).toMatch(/tab=x-privacy&x=%2Fsettings%2Faudience_and_tagging$/);
  await expect.poll(() => moves.at(-1)).toBe("/settings/audience_and_tagging");
  // X's own title and words, X's order, without X's header.
  await expect
    .element(screen.getByRole("heading", { name: "Audience, media and tagging" }))
    .toBeVisible();
  await expect.element(screen.getByText("Anyone can tag you")).toBeVisible();
  expect(screen.container.textContent).not.toContain("@you");

  await userEvent.click(screen.getByRole("checkbox", { name: /Protect your posts/ }));
  await expect.poll(() => pressed).toEqual([true]);
  // X redraws its checkbox: Xtend shows X's word for it.
  await expect.element(screen.getByRole("checkbox", { name: /Protect your posts/ })).toBeChecked();
});

it("keeps X's password page X's own: over the main area under Xtend's bar, nothing of it read", async () => {
  x.innerHTML = "";
  await using screen = await render(ui, {
    router: "/settings?tab=x-account&x=%2Fsettings%2Fpassword",
    service,
  });
  await expect.poll(probe).toMatch(/^over true bar Password reset /);
  await expect.poll(() => moves.at(-1)).toBe("/settings/password");
  await expect.element(screen.getByText(/stays X's own page/)).toBeVisible();
});
