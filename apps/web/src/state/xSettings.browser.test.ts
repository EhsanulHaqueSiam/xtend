import { expect, it } from "vite-plus/test";

import { markXReady, registerXWebview, type XWebview } from "./x";
import { readXSettings, xSettingsPress } from "./xSettings";

// X's settings markup as its components draw it (bundle.Settings, SettingsInternals): a page's
// header (Back, its title, the @handle), link rows, <label> checkboxes, radio groups.
let ids = 0;
const check = (label: string, help: string, checked: boolean) =>
  `<div><label><div><div dir="ltr"><span>${label}</span></div><div><div></div><input type="checkbox" aria-describedby="CHECKBOX_${++ids}_LABEL"${checked ? " checked" : ""}></div></div>${help === "" ? "" : `<div dir="ltr"><span>${help}</span> <a href="https://help.x.com/a">Learn more</a></div>`}</label></div>`;
const link = (label: string, href: string, description = "") =>
  `<a href="${href}" role="tab" data-testid="pivot"><div><div><div dir="ltr"><span>${label}</span></div>${description === "" ? "" : `<div dir="ltr" data-testid="pivot-description"><span>${description}</span></div>`}</div><svg></svg></div></a>`;
const heading = (text: string) =>
  `<div role="heading" aria-level="2"><div dir="ltr"><span>${text}</span></div></div>`;
const radio = (name: string, label: string, checked: boolean) => {
  const id = ++ids;
  return `<label><div><div id="r${id}" dir="ltr"><span>${label}</span></div><div><input type="radio" name="${name}" aria-labelledby="r${id}" aria-describedby="d${id}"${checked ? " checked" : ""}></div></div></label>`;
};
const xPage = (title: string, body: string) =>
  `<main role="main"><section aria-labelledby="detail-header"><div><div><button data-testid="app-bar-back" aria-label="Back"><svg></svg></button></div><div><h2 id="detail-header" role="heading" aria-level="2" dir="ltr"><span>${title}</span></h2><div dir="ltr"><span>@you</span></div></div></div><div>${body}</div></section></main>`;

const MUTED = xPage(
  "Muted notifications",
  heading("Mute notifications from people:") +
    check("You don’t follow", "", false) +
    check("Who don’t follow you", "", false) +
    check("With a new account", "", true) +
    check("Who have a default profile photo", "", true) +
    check("Who haven’t confirmed their email", "", false) +
    check("Who haven’t confirmed their phone number", "", false) +
    `<div dir="ltr"><span>These filters won’t affect notifications from people you follow.</span> <a href="https://support.x.com/articles/20169398">Learn more</a></div>`,
);

it("reads X's settings page in X's order and words: heads, checkboxes with their state, links and lines, without X's header", () => {
  document.body.innerHTML = MUTED;
  const read = readXSettings(document, "/settings");
  expect(read.title).toBe("Muted notifications");
  expect(read.typing).toBe(false);
  expect(read.items.map((i) => (i.kind === "check" ? `${i.label}:${i.checked}` : i.kind))).toEqual([
    "heading",
    "You don’t follow:false",
    "Who don’t follow you:false",
    "With a new account:true",
    "Who have a default profile photo:true",
    "Who haven’t confirmed their email:false",
    "Who haven’t confirmed their phone number:false",
    "text",
    "link",
  ]);
  expect(read.items.at(-2)).toEqual({
    kind: "text",
    text: "These filters won’t affect notifications from people you follow.",
  });
  expect(read.items.at(-1)).toMatchObject({ kind: "link", label: "Learn more", external: true });

  // A checkbox's help and its Learn more are its hint; a link row's description is its hint.
  document.body.innerHTML = xPage(
    "Audience and tagging",
    check(
      "Protect your posts",
      "When selected, your posts are only visible to people who follow you.",
      false,
    ) + link("Photo tagging", "/settings/tagging", "Anyone can tag you"),
  );
  expect(readXSettings(document, "/settings").items).toEqual([
    {
      kind: "check",
      label: "Protect your posts",
      hint: "When selected, your posts are only visible to people who follow you. Learn more",
      checked: false,
      disabled: false,
      toggle: false,
    },
    {
      kind: "link",
      label: "Photo tagging",
      hint: "Anyone can tag you",
      href: "/settings/tagging",
      external: false,
    },
  ]);
});

// X's compact layout (a window under about 1000px wide, as the engine is beside Xtend's panel),
// read live: no labelled section, the title an h2 in the app bar beside Back, the body after it.
const compactCheck = (label: string, n: number) =>
  `<div><div><label><div><div dir="ltr"><span>${label}</span></div><div><div><div></div></div><input aria-describedby="CHECKBOX_${n}_LABEL" type="checkbox"></div></div></label></div></div>`;
const COMPACT = `<main role="main"><div><div><div><button aria-label="Back" role="button" data-testid="app-bar-back" type="button"><svg></svg></button></div><div><div><h2 dir="ltr" aria-level="2" role="heading"><span>Muted notifications</span></h2></div></div></div><div><div><div><h2 aria-level="2" role="heading"><div></div><div dir="ltr"><span>Mute notifications from people:</span></div><div></div></h2></div><div>${[
  "You don’t follow",
  "Who don’t follow you",
  "With a new account",
  "Who have a default profile photo",
  "Who haven’t confirmed their email",
  "Who haven’t confirmed their phone number",
]
  .map((l, i) => compactCheck(l, i + 1))
  .join(
    "",
  )}<div dir="ltr">These filters won’t affect notifications from people you follow. <a href="https://support.x.com/articles/20169398"><span>Learn more</span></a></div></div></div></div></div></main>`;

it("reads X's compact settings page the same way: its title from the app bar, its heading, checkboxes and lines", () => {
  document.body.innerHTML = COMPACT;
  const read = readXSettings(document, "/settings/notifications/advanced_filters");
  expect(read.title).toBe("Muted notifications");
  expect(read.items.map((i) => (i.kind === "check" ? i.label : i.kind))).toEqual([
    "heading",
    "You don’t follow",
    "Who don’t follow you",
    "With a new account",
    "Who have a default profile photo",
    "Who haven’t confirmed their email",
    "Who haven’t confirmed their phone number",
    "text",
    "link",
  ]);
  expect(read.items[0]).toEqual({ kind: "heading", text: "Mute notifications from people:" });
});

it("reads X's radio groups by their labels, and a page asking for a password as X's own to type in", () => {
  document.body.innerHTML = xPage(
    "Display",
    `<div role="radiogroup" aria-label="Background options">${radio("bg", "Light", false)}${radio("bg", "Lights out", true)}</div>`,
  );
  expect(readXSettings(document, "/settings").items).toEqual([
    {
      kind: "radio",
      group: "Background options",
      label: "Light",
      hint: "",
      checked: false,
      disabled: false,
    },
    {
      kind: "radio",
      group: "Background options",
      label: "Lights out",
      hint: "",
      checked: true,
      disabled: false,
    },
  ]);

  document.body.innerHTML = xPage(
    "Account information",
    `<div><div dir="ltr"><span>Confirm your password</span></div><label><input type="password" name="password"></label><button>Confirm</button></div>`,
  );
  expect(readXSettings(document, "/settings").typing).toBe(true);
});

it("presses X's own checkbox at its place only while X draws the same one there", async () => {
  registerXWebview({
    loadURL: async () => {},
    getURL: () => "https://x.com/settings/notifications/advanced_filters",
    executeJavaScript: (code: string) =>
      Promise.resolve(
        new Function(
          `return ${code.replaceAll("location.pathname", JSON.stringify("/settings/notifications/advanced_filters"))}`,
        )(),
      ),
  } as unknown as XWebview);
  markXReady();
  document.body.innerHTML = MUTED;
  const changed: Array<string> = [];
  for (const input of document.querySelectorAll("input"))
    input.addEventListener("change", () => changed.push(String(input.checked)));
  const read = readXSettings(document, "/settings");
  const path = "/settings/notifications/advanced_filters";

  expect(await xSettingsPress(path, 1, read.items[1]!, () => {})).toBe("done");
  expect(changed).toEqual(["true"]);
  // X's page draws another checkbox there now: nothing is pressed.
  expect(await xSettingsPress(path, 2, read.items[1]!, () => {})).toBeNull();
  // Another page of X's: nothing is pressed either.
  expect(await xSettingsPress("/settings/search", 1, read.items[1]!, () => {})).toBeNull();
  expect(changed).toEqual(["true"]);
});
