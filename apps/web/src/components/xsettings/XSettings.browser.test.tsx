import "../../index.css";
import { useAtomValue } from "@effect/atom-react";
import { useLocation } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import type { FakeService } from "../../../test/fakeService";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import type { XWebview } from "../../state/x";
import { Toasts } from "../ui/toast";

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
    if (to !== undefined) {
      moves.push(to);
      return Promise.resolve(true);
    }
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
    <Toasts />
  </div>
);
const probe = () => document.querySelector('[data-testid="probe"]')?.textContent ?? "";
/** What the screen filed in the change log, as the service got it. */
const filed: Array<{ readonly values: string; readonly pressed: ReadonlyArray<string> }> = [];
/** The last value the fake log saw per key, so it answers with a change as the service does. */
const last = new Map<string, string>();
const service: FakeService = {
  "accounts.list": () => Effect.succeed({ accounts: [], currentId: 1 }),
  "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
  "xSettings.seen": ({ accountId, values, pressed }) =>
    Effect.sync(() => {
      expect(accountId).toBe(1);
      filed.push({ values: values.map((v) => `${v.label}=${v.value}`).join(", "), pressed });
      return values.flatMap((v) => {
        const from = last.get(v.key);
        last.set(v.key, v.value);
        return from === undefined || from === v.value
          ? []
          : [
              {
                ...v,
                from,
                to: v.value,
                at: "2026-11-04T10:00:00.000Z",
                inXtend: pressed.includes(v.key),
              },
            ];
      });
    }),
  "xSettings.changes": () =>
    Effect.succeed([
      {
        key: "/settings/notifications/filters Quality filter",
        page: "Filters",
        label: "Quality filter",
        from: "On",
        to: "Off",
        at: "2026-11-02T09:00:00.000Z",
        inXtend: false,
      },
    ]),
};

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
  // The log gets what X's page drew, the press named as the user's; its rail shows X's flip elsewhere.
  expect(filed.at(0)).toEqual({ values: "Protect your posts=Off", pressed: [] });
  await expect
    .poll(() => filed.at(-1))
    .toEqual({
      values: "Protect your posts=On",
      pressed: ["/settings/audience_and_tagging Protect your posts"],
    });
  // The rail folds away at this width, as it does beside a narrow main area.
  await expect.element(screen.getByText(/not from Xtend · Filters/)).toBeInTheDocument();
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

it("presses none of X's controls while session actions are off, and says so", async () => {
  x.innerHTML = AUDIENCE;
  const pressed: Array<boolean> = [];
  x.querySelector("input")!.addEventListener("change", () => pressed.push(true));
  await using screen = await render(ui, {
    router: "/settings?tab=x-privacy&x=%2Fsettings%2Faudience_and_tagging",
    service: { ...service, "settings.get": () => Effect.succeed(settings) },
  });
  await userEvent.click(screen.getByRole("checkbox", { name: /Protect your posts/ }));
  await expect
    .element(screen.getByText("Session actions are off in Settings, X session."))
    .toBeVisible();
  expect(pressed).toEqual([]);
  await expect
    .element(screen.getByRole("checkbox", { name: /Protect your posts/ }))
    .not.toBeChecked();
});

it("files the user's change as theirs when X shows it after they left, and a cancelled confirm as nobody's", async () => {
  const key = "/settings/audience_and_tagging Protect your posts";
  last.clear();
  filed.length = 0;
  // X takes the click but draws its change later.
  x.innerHTML = AUDIENCE;
  x.querySelector("input")!.addEventListener("click", (e) => e.preventDefault());
  await using screen = await render(ui, {
    router: "/settings?tab=x-privacy&x=%2Fsettings%2Faudience_and_tagging",
    service,
  });
  const protect = screen.getByRole("checkbox", { name: /Protect your posts/ });
  await userEvent.click(protect);
  await expect.element(protect).toBeDisabled();
  await expect.element(protect).toBeEnabled();
  // Gone before X draws it; back once X shows it on.
  x.innerHTML = "";
  await screen.router!.navigate({ href: "/settings?tab=x-notifications" });
  x.innerHTML = AUDIENCE.replace('type="checkbox"', 'type="checkbox" checked');
  await screen.router!.navigate({
    href: "/settings?tab=x-privacy&x=%2Fsettings%2Faudience_and_tagging",
  });
  await expect
    .poll(() => filed.at(-1))
    .toEqual({ values: "Protect your posts=On", pressed: [key] });

  // X asks first, and the user cancels in X's sheet: X's value stays.
  const input = x.querySelector("input")!;
  input.addEventListener("click", (e) => {
    e.preventDefault();
    const sheet = document.createElement("div");
    sheet.setAttribute("role", "alertdialog");
    x.append(sheet);
  });
  await userEvent.click(screen.getByRole("checkbox", { name: /Protect your posts/ }));
  await expect.poll(() => x.querySelector('[role="alertdialog"]')).not.toBeNull();
  x.querySelector('[role="alertdialog"]')!.remove();
  await expect.element(screen.getByRole("checkbox", { name: /Protect your posts/ })).toBeEnabled();
  // Turned off later in X's app: X's page shows it, and it is not the user's click in Xtend.
  input.checked = false;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => filed.at(-1)).toEqual({ values: "Protect your posts=Off", pressed: [] });
});
