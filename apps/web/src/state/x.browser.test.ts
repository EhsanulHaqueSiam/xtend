import { expect, it } from "vite-plus/test";

import {
  markXReady,
  registerXWebview,
  xActInPlace,
  xFollow,
  xPostMenu,
  xOverEnded,
  xPostMenuPress,
  xProfileMenu,
  xProfileMenuPress,
  xVote,
  type XWebview,
} from "./x";

// X's page as the engine holds it: a post quoting 42, then 42 itself, edited, so its timestamp
// links to its edit history.
const X_PAGE = `
  <article id="quote"><a href="/ann/status/7"><time></time></a><a href="/theo/status/42">quoted</a>
    <button data-testid="bookmark"></button></article>
  <article id="edited"><a href="/theo/status/42/history"><time></time></a>
    <button data-testid="bookmark"></button></article>`;

it("presses X's button on the post's own article, edited or not, never on a post quoting it", async () => {
  document.body.innerHTML = X_PAGE;
  const pressed: Array<string> = [];
  // X turns a pressed button over to its undo.
  for (const b of document.querySelectorAll("button"))
    b.addEventListener("click", () => {
      pressed.push(b.closest("article")!.id);
      b.dataset.testid = "removeBookmark";
    });
  // The engine's scripts run in X's page; here, in this document.
  const el = {
    loadURL: async () => {},
    getURL: () => "https://x.com/home",
    // oxlint-disable-next-line no-implied-eval -- the script under test is the one sent to X's page
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  registerXWebview(el as unknown as XWebview);
  markXReady();

  expect(await xActInPlace("42", "bookmark")).toBe(true);
  expect(pressed).toEqual(["edited"]);
});

/** Runs the engine's scripts in this document, as X's page at `url` would. */
const inThisPage = (url = () => "https://x.com/theo") => {
  const el = {
    loadURL: async () => {},
    getURL: url,
    // oxlint-disable-next-line no-implied-eval -- the script under test is the one sent to X's page
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  registerXWebview(el as unknown as XWebview);
  markXReady();
};

/** X's confirm sheet: pressing `button` opens it, and its confirm turns `button` into `turns`. */
const withConfirm = (button: HTMLElement, confirmId: string, turns: string, log: Array<string>) =>
  button.addEventListener("click", () => {
    log.push(button.dataset.testid!);
    const confirm = document.createElement("button");
    confirm.dataset.testid = confirmId;
    confirm.addEventListener("click", () => {
      log.push(confirmId);
      button.dataset.testid = turns;
    });
    document.body.append(confirm);
  });

it("undoes a repost and an unfollow through X's confirm", async () => {
  document.body.innerHTML = `
    <article><a href="/theo/status/42"><time></time></a><button data-testid="unretweet"></button></article>
    <div><button data-testid="786-unfollow"></button></div>`;
  const log: Array<string> = [];
  withConfirm(
    document.querySelector('[data-testid="unretweet"]')!,
    "unretweetConfirm",
    "retweet",
    log,
  );
  withConfirm(
    document.querySelector('[data-testid="786-unfollow"]')!,
    "confirmationSheetConfirm",
    "786-follow",
    log,
  );
  inThisPage();

  expect(await xActInPlace("42", "unretweet")).toBe(true);
  expect(await xFollow({ userId: "786", handle: "theo" }, false)).toBe(true);
  expect(log).toEqual([
    "unretweet",
    "unretweetConfirm",
    "786-unfollow",
    "confirmationSheetConfirm",
  ]);
});

it("follows the person asked for, waiting past another person's button drawn first", async () => {
  // X's page shows a recommendation's button now; the profile's own button comes a moment later.
  document.body.innerHTML = `<div><button data-testid="999-follow"></button></div>`;
  const log: Array<string> = [];
  setTimeout(() => {
    const own = document.createElement("div");
    own.innerHTML = `<button data-testid="786-follow"></button>`;
    const button = own.querySelector("button")!;
    button.addEventListener("click", () => {
      log.push(button.dataset.testid!);
      button.dataset.testid = "786-unfollow";
    });
    document.body.append(own);
  }, 500);
  inThisPage();
  expect(await xFollow({ userId: "786", handle: "theo" }, true)).toBe(true);
  expect(log).toEqual(["786-follow"]);
});

/**
 * A menu on post 42 (its "...", or the button `trigger` selects): pressing it draws the rows
 * with a mask beside them, as X does.
 */
const withMenu = (
  rows: Record<string, () => void>,
  trigger = '[data-testid="caret"]',
  button = `<button data-testid="caret"></button>`,
) => {
  document.body.innerHTML = `<article><a href="/theo/status/42"><time></time></a>${button}</article>`;
  document.querySelector(trigger)!.addEventListener("click", () => {
    const layer = document.createElement("div");
    layer.innerHTML = `<div style="height:10px"></div><div role="menu"><div data-testid="Dropdown">${Object.keys(
      rows,
    )
      .map((row) => `<div role="menuitem">${row}</div>`)
      .join("")}</div></div>`;
    layer.firstElementChild!.addEventListener("click", () => layer.remove());
    for (const item of layer.querySelectorAll('[role="menuitem"]'))
      item.addEventListener("click", () => {
        layer.remove();
        rows[item.textContent!]!();
      });
    document.body.append(layer);
  });
  inThisPage();
};
const post42 = { postId: "42", handle: "theo" };

it(`reads X's own "..." rows and closes X's menu, pressing nothing`, async () => {
  const pressed: Array<string> = [];
  withMenu({
    "Mute @theo": () => pressed.push("mute"),
    "Report post": () => pressed.push("report"),
  });
  expect(await xPostMenu(post42)).toEqual(["Mute @theo", "Report post"]);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(pressed).toEqual([]);
});

it("presses only the row asked for: X's toast comes back, X's dialog keeps the engine over until it closes", async () => {
  withMenu({
    "Mute @theo": () =>
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div data-testid="toast" role="alert">You muted @theo<button>Undo</button></div>`,
      ),
    "Block @theo": () =>
      document.body.insertAdjacentHTML("beforeend", `<div role="alertdialog"></div>`),
  });
  expect(await xPostMenuPress(post42, "Mute @theo", () => {})).toEqual({
    kind: "done",
    toast: "You muted @theo",
    undo: true,
  });
  const shown: Array<boolean> = [];
  const outcome = await xPostMenuPress(post42, "Block @theo", (on) => {
    shown.push(on);
    // The user answers X's sheet.
    if (on) setTimeout(() => document.querySelector('[role="alertdialog"]')?.remove(), 200);
  });
  expect(outcome?.kind).toBe("over");
  expect(shown).toEqual([true, false]);
});

it("leaves X's dialog to the screen it was opened on when the user moves on before X answers", async () => {
  withMenu({
    "Block @theo": () =>
      document.body.insertAdjacentHTML("beforeend", `<div role="alertdialog"></div>`),
  });
  const shown: Array<boolean> = [];
  const pressing = xPostMenuPress(post42, "Block @theo", (on) => shown.push(on));
  xOverEnded();
  expect((await pressing)?.kind).toBe("over");
  expect(shown).toEqual([]);
});

it("reads X's share rows from its share button, and Send via Chat keeps X's dialog over", async () => {
  withMenu(
    {
      "Send via Chat": () =>
        document.body.insertAdjacentHTML("beforeend", `<div role="dialog"></div>`),
      "Copy link": () => {},
    },
    'button[aria-label="Share post"]',
    `<div role="group"><button aria-label="Share post"></button></div>`,
  );
  expect(await xPostMenu(post42, "share")).toEqual(["Send via Chat", "Copy link"]);
  const shown: Array<boolean> = [];
  const outcome = await xPostMenuPress(
    post42,
    "Send via Chat",
    (on) => {
      shown.push(on);
      if (on) setTimeout(() => document.querySelector('[role="dialog"]')?.remove(), 200);
    },
    "share",
  );
  expect(outcome?.kind).toBe("over");
  expect(shown).toEqual([true, false]);
});

it(`opens a profile's "..." only on that person's page, and keeps X's About page over until X is back`, async () => {
  const opened: Array<string> = [];
  withMenu(
    {
      Mute: () => {},
      "About this account": () => history.replaceState(null, "", "/theo/about"),
    },
    '[data-testid="userActions"]',
    `<button data-testid="userActions"></button>`,
  );
  document
    .querySelector('[data-testid="userActions"]')!
    .addEventListener("click", () => opened.push(location.pathname));
  // X's page is wherever this document's path says.
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    // The engine shows someone else's profile: X's router takes it to theo's first.
    history.replaceState(null, "", "/ann");
    expect(await xProfileMenu("theo")).toEqual(["Mute", "About this account"]);
    expect(opened).toEqual(["/theo"]);
    // And Back again, to the page it was on.
    await expect.poll(() => location.pathname).toBe("/ann");
    history.replaceState(null, "", "/theo");
    const shown: Array<boolean> = [];
    const outcome = await xProfileMenuPress("theo", "About this account", (on) => {
      shown.push(on);
      // The user leaves X's page with its back arrow.
      if (on) setTimeout(() => history.replaceState(null, "", "/theo"), 200);
    });
    expect(outcome).toEqual({ kind: "over", path: "/theo" });
    expect(shown).toEqual([true, false]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("votes by pressing X's radio for that choice on the post's own poll, and waits for X's results", async () => {
  document.body.innerHTML = `<article><a href="/theo/status/42"><time></time></a>
    <div data-testid="cardPoll"><div role="radiogroup">
      <div role="radio"><span>Tabs</span></div><div role="radio"><span>Spaces</span></div>
    </div></div></article>`;
  const pressed: Array<string> = [];
  for (const r of document.querySelectorAll('[role="radio"]'))
    r.addEventListener("click", () => {
      pressed.push(r.textContent!);
      // X swaps its choices for the results.
      setTimeout(() => document.querySelector('[role="radiogroup"]')?.remove(), 100);
    });
  inThisPage();
  expect(await xVote(post42, "Maybe")).toBe(false);
  expect(await xVote(post42, "Spaces")).toBe(true);
  expect(pressed).toEqual(["Spaces"]);
});
