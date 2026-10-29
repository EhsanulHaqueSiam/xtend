import { expect, it } from "vite-plus/test";

import { X_SKIN_CSS, xSkinCss } from "./xSkin.ts";

// A selector the browser cannot parse (nested :has(), say) drops its whole rule without a
// word, so the skin would quietly stop hiding something. Every rule must survive parsing.
it("parses every rule of the skin, every toggle on", () => {
  const css = xSkinCss([
    "ads",
    "grok",
    "upsells",
    "chrome",
    "discover",
    "boosts",
    "extras",
    "forYou",
    "views",
    "badges",
    "quietMedia",
  ]);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const written = css.split("{").length - 1;
  expect(sheet.cssRules.length).toBe(written);
});

it("hides only what its toggles say", () => {
  document.body.innerHTML = `<article><svg data-testid="icon-verified" id="badge"></svg><header role="banner" id="banner"></header></article>`;
  const style = document.createElement("style");
  style.textContent = xSkinCss(["badges"]);
  document.head.append(style);
  const display = (id: string) => getComputedStyle(document.getElementById(id)!).display;
  expect(display("badge")).toBe("none");
  expect(display("banner")).not.toBe("none");
  style.remove();
});

it("hides X's navigation and right column in the newer client", () => {
  document.body.innerHTML = `
    <div id="row"><div id="nav"><nav></nav></div><div id="grid"><main id="main"></main><aside id="aside"></aside></div></div>`;
  const style = document.createElement("style");
  style.textContent = X_SKIN_CSS;
  document.head.append(style);
  const display = (id: string) => getComputedStyle(document.getElementById(id)!).display;
  expect(display("nav")).toBe("none");
  expect(display("aside")).toBe("none");
  expect(display("main")).not.toBe("none");
  style.remove();
});

it("keeps the legacy client's layers (menus, modals) visible", () => {
  document.body.innerHTML = `
    <div id="root"><div id="app"><header role="banner" id="banner"></header><main role="main"></main></div><div id="layers"></div></div>`;
  const style = document.createElement("style");
  style.textContent = X_SKIN_CSS;
  document.head.append(style);
  const display = (id: string) => getComputedStyle(document.getElementById(id)!).display;
  expect(display("banner")).toBe("none");
  expect(display("layers")).not.toBe("none");
  style.remove();
});

it("lets the legacy client's main span the row so the column can centre in it", () => {
  document.body.innerHTML = `<div style="display:flex;width:1400px"><main role="main" id="main" style="flex-grow:1"><div id="column"></div></main></div>`;
  const style = document.createElement("style");
  style.textContent = X_SKIN_CSS;
  document.head.append(style);
  expect(document.getElementById("main")!.getBoundingClientRect().width).toBe(1400);
  expect(getComputedStyle(document.getElementById("column")!).maxWidth).toBe("640px");
  style.remove();
});
