import { expect, it, vi } from "vite-plus/test";

import type { EngineBatch } from "@xtend/contracts";
import { fakeTimers, stubGlobal } from "../../test/render";

import {
  communityButton,
  listButton,
  markXReady,
  xAct,
  registerXWebview,
  xCommunityJoin,
  xCommunityPin,
  xListDialog,
  xListFollow,
  xListPin,
  xEditProfile,
  xActInPlace,
  xFolderDialog,
  xFollow,
  xAudienceCard,
  xGifIdle,
  xGifPicker,
  xPostMenu,
  xOverEnded,
  xPickCommunitySearchTab,
  xPickHomeTab,
  xPickInspiration,
  xPickAnalyticsRange,
  xAnalyticsSelected,
  xAnalyticsUpsell,
  xRadarCreate,
  xRadarDelete,
  xPostFollowPress,
  xPostMenuPress,
  xProfileMenu,
  xProfileMenuPress,
  xSortReplies,
  xScrollMore,
  xSubscribe,
  xVote,
  xTrendMenu,
  xTrendMenuPress,
  type XWebview,
  xPickGameTab,
  xHeard,
  xNavigate,
  xGo,
  xChecklist,
  xControl,
  xPressToPage,
  xPressRow,
} from "./x";

// X's page as the engine holds it: a post quoting 42, then 42 itself, edited, so its timestamp
// links to its edit history.
const X_PAGE = `
  <article id="quote"><a href="/ann/status/7"><time></time></a><a href="/theo/status/42">quoted</a>
    <button data-testid="bookmark"></button></article>
  <article id="edited"><a href="/theo/status/42/history"><time></time></a>
    <button data-testid="bookmark"></button></article>`;

it("presses X's button on the post's own article, edited or not, never on a post quoting it, and once only", async () => {
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
    executeJavaScript: (code: string) => Promise.resolve(new Function(`return ${code}`)()),
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  registerXWebview(el as unknown as XWebview);
  markXReady();

  expect(await xActInPlace("42", "bookmark")).toBe(true);
  expect(pressed).toEqual(["edited"]);

  // X refuses: the press says so, and nothing presses again on the post's page, which could undo it.
  // Another post's button, already turned, is not this post's answer.
  document.body.innerHTML = `<article><a href="/theo/status/43"><time></time></a><button data-testid="bookmark"></button></article>
    <article><a href="/ann/status/44"><time></time></a><button data-testid="removeBookmark"></button></article>`;
  let presses = 0;
  document.querySelector("button")!.addEventListener("click", () => presses++);
  expect(await xAct({ postId: "43", handle: "theo" }, "bookmark")).toBe(false);
  expect(presses).toBe(1);
});

/** Runs the engine's scripts in this document, as X's page at `url` would. */
const inThisPage = (url = () => "https://x.com/theo") => {
  const el = {
    loadURL: async () => {},
    getURL: url,
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

it("follows the person asked for, waiting past another person's button drawn first, and says when X refuses", async () => {
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

  // X refuses: its button stays Follow, and the press says so instead of claiming the follow.
  document.body.innerHTML = `<div><button data-testid="786-follow"></button></div>`;
  expect(await xFollow({ userId: "786", handle: "theo" }, true)).toBe(false);
});

/** X reflects the active menu on its caret, including when a delayed dropdown replaces another. */
const drawMenu = (caret: Element, rows: Record<string, () => void>) => {
  for (const other of document.querySelectorAll('[aria-expanded="true"]'))
    other.setAttribute("aria-expanded", "false");
  for (const menu of document.querySelectorAll("[data-fake-menu]")) menu.remove();
  caret.setAttribute("aria-haspopup", "menu");
  caret.setAttribute("aria-expanded", "true");
  const layer = document.createElement("div");
  layer.dataset.fakeMenu = "";
  layer.innerHTML = `<div style="height:10px"></div><div role="menu"><div data-testid="Dropdown">${Object.keys(
    rows,
  )
    .map((row) => `<div role="menuitem">${row}</div>`)
    .join("")}</div></div>`;
  const close = () => {
    layer.remove();
    caret.setAttribute("aria-expanded", "false");
  };
  layer.firstElementChild!.addEventListener("click", close);
  for (const item of layer.querySelectorAll('[role="menuitem"]'))
    item.addEventListener("click", () => {
      close();
      rows[item.textContent!]!();
    });
  document.body.append(layer);
  return layer;
};

/** A menu on post 42; no aria-controls, as on X's trend carets. */
const withMenu = (
  rows: Record<string, () => void>,
  trigger = '[data-testid="caret"]',
  button = `<button data-testid="caret"></button>`,
) => {
  document.body.innerHTML = `<article><a href="/theo/status/42"><time></time></a>${button}</article>`;
  const caret = document.querySelector(trigger)!;
  caret.setAttribute("aria-haspopup", "menu");
  caret.setAttribute("aria-expanded", "false");
  caret.addEventListener("click", () => drawMenu(caret, rows));
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
    gone: false,
    current: true,
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

it("leaves X's dialog, a Subscribe still waiting, and an Unfollow's reread to the screen they began on when the user moves on", async () => {
  const blocked: Array<string> = [];
  withMenu({ "Block @theo": () => blocked.push("Block @theo") });
  const shown: Array<boolean> = [];
  // Moved on before the press reached X's page: X's row is never pressed, nothing shows over.
  const pressing = xPostMenuPress(post42, "Block @theo", (on) => shown.push(on));
  xOverEnded();
  expect(await pressing).toBeNull();
  expect(blocked).toEqual([]);
  expect(shown).toEqual([]);

  // A Subscribe whose button X draws only after the user moved on never clicks it.
  document.body.innerHTML = "";
  const clicked: Array<string> = [];
  const subscribing = xSubscribe({ userId: "786", handle: "theo" }, (on) => shown.push(on));
  xOverEnded();
  document.body.innerHTML = `<button data-testid="786-subscribe"></button>`;
  document.querySelector("button")!.addEventListener("click", () => clicked.push("subscribe"));
  expect(await subscribing).toBe(false);
  expect(clicked).toEqual([]);

  // An Unfollow the user left before it reached X's page: X's menu is never opened for it.
  let opened = 0;
  withMenu({
    "Unfollow @theo": () =>
      document.body.insertAdjacentHTML("beforeend", `<div role="alertdialog"></div>`),
  });
  document.querySelector('[data-testid="caret"]')!.addEventListener("click", () => opened++);
  const unfollowing = xPostFollowPress(post42, "Unfollow @theo", (on) => shown.push(on));
  xOverEnded();
  expect((await unfollowing)?.following).toBeNull();
  expect(opened).toBe(0);

  // The user moves on while X's menu is being read again: what it says no longer counts.
  let opens = 0;
  withMenu({ "Follow @theo": () => {} });
  document.querySelector('[data-testid="caret"]')!.addEventListener("click", () => {
    if (++opens === 2) xOverEnded();
  });
  const following = xPostFollowPress(post42, "Follow @theo", (on) => shown.push(on));
  expect((await following)?.following).toBeNull();
  expect(opens).toBe(2);
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

it("sorts replies through X's own row under the post, and only reports a sort X put in its URL", async () => {
  const start = location.pathname + location.search;
  const sortAt = (search: string) => () =>
    history.replaceState(null, "", `${location.pathname}${search}`);
  withMenu(
    // X drops a pick it gets while its first fetch of the thread is out: Likes leaves the URL alone.
    { Relevant: sortAt(""), Recent: sortAt("?sort_replies=recency"), Likes: () => {} },
    'button[aria-haspopup="menu"]',
    `<div><button aria-haspopup="menu">Relevant</button></div>`,
  );
  const labels = ["Relevant", "Recent", "Likes"];
  try {
    expect(await xSortReplies(post42, { label: "Recent", param: "recency" }, labels)).toBe(true);
    expect(location.search).toBe("?sort_replies=recency");
    expect(await xSortReplies(post42, { label: "Likes", param: "likes" }, labels)).toBe(false);
  } finally {
    history.replaceState(null, "", start);
  }
});

/**
 * A Community's header as X draws it: banner, name, a link to its members, X's Pin (an icon
 * labelled with what pressing it does) and X's membership button.
 */
const header = (id: string, label: string, pin = "Pin Community") =>
  `<div><img alt=""><h2>C${id}</h2><a href="/i/communities/${id}/members"><b>9</b> Members</a><button aria-label="${pin}"></button><button aria-label="${label} C${id}">${label}</button></div>`;
const page = (html: string) => {
  const root = document.createElement("div");
  root.innerHTML = `<main><nav><a href="/home">Home</a></nav>${html}</main>`;
  return root;
};
const label = (root: ParentNode, path: string, id: string) =>
  communityButton(root, path, id, "join")?.textContent ?? null;
const pinLabel = (root: ParentNode, path: string, id: string) =>
  communityButton(root, path, id, "pin")?.getAttribute("aria-label") ?? null;

it("finds X's membership and Pin buttons only in the header X draws for the Community its page is on", () => {
  const eleven = page(header("11", "Join"));
  expect(label(eleven, "/i/communities/11", "11")).toBe("Join");
  expect(label(eleven, "/i/communities/11/about", "11")).toBe("Join");
  // X moved to Community 12 before drawing it: 11's header is still up, and is not 12's.
  expect(label(eleven, "/i/communities/12", "12")).toBeNull();
  // The path names Community 110, not 11, however it starts.
  expect(label(eleven, "/i/communities/110", "11")).toBeNull();
  // A button in no Community's header, or one box holding two buttons, is no one's.
  expect(label(page("<button>Join</button>"), "/i/communities/11", "11")).toBeNull();
  expect(
    label(
      page(
        `<div><a href="/i/communities/11/members">9</a><button>Join</button><button>Joined</button></div>`,
      ),
      "/i/communities/11",
      "11",
    ),
  ).toBeNull();
  // Two headers side by side (X drawing the next Community over the last): each is its own.
  // X's pinned label is "Unpin" or a longer "Unpin Community ..."; each is the header's Pin.
  const both = page(
    header("11", "Joined") +
      header("12", "Ask to join", "Unpin") +
      header("13", "Join", "Unpin Community from Home screen"),
  );
  expect([label(both, "/i/communities/11", "11"), label(both, "/i/communities/12", "12")]).toEqual([
    "Joined",
    "Ask to join",
  ]);
  expect([
    pinLabel(both, "/i/communities/11", "11"),
    pinLabel(both, "/i/communities/12", "12"),
    pinLabel(both, "/i/communities/13", "13"),
    pinLabel(eleven, "/i/communities/12", "12"),
  ]).toEqual(["Pin Community", "Unpin", "Unpin Community from Home screen", null]);
});

it("presses X's membership button only for the action the user clicked, and says what X's says after", async () => {
  document.body.innerHTML = header("11", "Join");
  const button = document.querySelector<HTMLElement>('button[aria-label$=" C11"]')!;
  const pressed: Array<string> = [];
  button.addEventListener("click", () => {
    pressed.push(button.textContent!);
    button.textContent = "Joined";
  });
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    history.replaceState(null, "", "/i/communities/11");
    // Xtend still says Joined (the user left on x.com since): its Leave presses nothing.
    expect(await xCommunityJoin("11", "leave", () => {})).toEqual({
      refused: true,
      label: "Join",
      toast: null,
    });
    expect(pressed).toEqual([]);
    expect(await xCommunityJoin("11", "join", () => {})).toEqual({
      refused: false,
      label: "Joined",
      toast: null,
    });
    expect(pressed).toEqual(["Join"]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("reads X's new membership label on the Community's own page, before the engine goes back", async () => {
  const start = location.pathname + location.search;
  // The Community is not where the engine is (a pinned pane on Messages): X's page is reached
  // through X's router, pressed there, then left.
  document.body.innerHTML = `<main>${header("21", "Join")}</main>`;
  const button = document.querySelector<HTMLElement>('button[aria-label$=" C21"]')!;
  button.addEventListener("click", () => (button.textContent = "Joined"));
  inThisPage(() => "https://x.com/messages");
  // Back draws the page the user had, as X does: Messages, with no Community header.
  const back = history.back.bind(history);
  history.back = () => {
    history.replaceState(null, "", "/messages");
    document.body.innerHTML = "<main></main>";
  };
  try {
    expect(await xCommunityJoin("21", "join", () => {})).toEqual({
      refused: false,
      label: "Joined",
      toast: null,
    });
  } finally {
    history.back = back;
    history.replaceState(null, "", start);
  }
});

it("finds a trend by its exact name, reads only its menu, and presses only the requested row", async () => {
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore/tabs/news");
  const pressed: Array<string> = [];
  withMenu({
    "This trend is spam": () => pressed.push("spam"),
    "This trend is abusive or harmful": () =>
      document.body.insertAdjacentHTML("beforeend", '<div role="dialog"></div>'),
    "Not interested in this": () => {
      pressed.push("not interested");
      document.querySelector("article")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div data-testid="toast">Thanks<button>Undo</button></div>',
      );
    },
  });
  const article = document.querySelector("article")!;
  article.dataset.testid = "trend";
  article.insertAdjacentHTML(
    "afterbegin",
    '<div style="font-weight:700"><span>A "quoted" trend <img alt="🧭"></span></div>',
  );
  const other = document.createElement("div");
  other.dataset.testid = "trend";
  other.innerHTML =
    '<div><span>A "quoted" trend 🧭</span><span> · Trending</span></div><div style="font-weight:700"><span>Another name</span></div><button data-testid="caret"></button>';
  other.querySelector("button")!.addEventListener("click", () => pressed.push("wrong trend"));
  article.before(other);
  try {
    const reading = xTrendMenu('A "quoted" trend 🧭');
    await vi.runAllTimersAsync();
    expect(await reading).toEqual([
      "This trend is spam",
      "This trend is abusive or harmful",
      "Not interested in this",
    ]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(pressed).toEqual([]);
    const missing = xTrendMenuPress('A "quoted" trend 🧭', "Not a row", () => {});
    await vi.runAllTimersAsync();
    expect(await missing).toBeNull();
    expect(pressed).toEqual([]);
    const shown: Array<boolean> = [];
    const dialog = xTrendMenuPress(
      'A "quoted" trend 🧭',
      "This trend is abusive or harmful",
      (on) => {
        shown.push(on);
        if (on) document.querySelector('[role="dialog"]')?.remove();
      },
    );
    await vi.runAllTimersAsync();
    expect((await dialog)?.kind).toBe("done");
    expect(shown).toEqual([true, false]);
    const pressing = xTrendMenuPress('A "quoted" trend 🧭', "Not interested in this", () => {});
    await vi.runAllTimersAsync();
    expect(await pressing).toEqual({
      kind: "done",
      toast: "Thanks",
      undo: true,
      gone: false,
      dismissed: true,
      current: true,
    });
    expect(pressed).toEqual(["not interested"]);

    document.body.append(article);
    expect(article.isConnected).toBe(true);
    const cancelled = xTrendMenuPress('A "quoted" trend 🧭', "This trend is spam", () => {});
    xOverEnded();
    await vi.runAllTimersAsync();
    expect(pressed).toEqual(["not interested"]);
    expect(await cancelled).toBeNull();
  } finally {
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it("keeps X's toast and Undo when a post menu press is cancelled after X's row was clicked", async () => {
  using _clock = fakeTimers();
  withMenu({
    "Mute @theo": () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div data-testid="toast">Muted<button>Undo</button></div>',
      );
      xOverEnded();
    },
  });
  const pressing = xPostMenuPress(post42, "Mute @theo", () => {});
  await vi.runAllTimersAsync();
  expect(await pressing).toMatchObject({
    kind: "done",
    toast: "Muted",
    undo: true,
    current: false,
  });
});

it.each([false, true])(
  "keeps a clicked trend's outcome when another menu is read or its tab is left (%s)",
  async (leave) => {
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore/tabs/news");
    let reading: Promise<ReadonlyArray<string> | null> | undefined;
    withMenu({
      "Not interested in this": () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div data-testid="toast">Thanks<button>Undo</button></div>',
        );
        if (leave) xOverEnded();
        else reading = xTrendMenu("Trend B");
      },
    });
    const article = document.querySelector("article")!;
    article.dataset.testid = "trend";
    article.insertAdjacentHTML(
      "afterbegin",
      '<div style="font-weight:700"><span>Trend A</span></div>',
    );
    const b = article.cloneNode(true) as HTMLElement;
    b.querySelector("span")!.textContent = "Trend B";
    b.querySelector("button")!.addEventListener("click", () => {
      drawMenu(b.querySelector("button")!, { "B feedback": () => {} });
    });
    article.after(b);
    try {
      const pressing = xTrendMenuPress("Trend A", "Not interested in this", () => {});
      await vi.runAllTimersAsync();
      expect(await pressing).toMatchObject({
        kind: "done",
        toast: "Thanks",
        undo: true,
        current: !leave,
      });
      if (!leave) expect(await reading).toEqual(["B feedback"]);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it.each(["read", "press"])(
  "cancels an undrawn trend read before a newer %s opens X's menu",
  async (next) => {
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore/tabs/news");
    const pressed: Array<string> = [];
    withMenu({ "Not interested in this": () => pressed.push("T2") });
    const t2 = document.querySelector("article")!;
    t2.dataset.testid = "trend";
    t2.insertAdjacentHTML("afterbegin", '<span style="font-weight:700">T2</span>');
    try {
      const stale = xTrendMenu("T1");
      await vi.advanceTimersByTimeAsync(100);
      const t1 = t2.cloneNode(true) as HTMLElement;
      t1.querySelector("span")!.textContent = "T1";
      const opened = vi.fn();
      t1.querySelector("button")!.addEventListener("click", opened);
      document.body.append(t1);
      const latest =
        next === "read"
          ? xTrendMenu("T2")
          : xTrendMenuPress("T2", "Not interested in this", () => {});
      await vi.runAllTimersAsync();
      expect(await stale).toBeNull();
      expect(opened).not.toHaveBeenCalled();
      if (next === "read") expect(await latest).toEqual(["Not interested in this"]);
      else expect(await latest).toMatchObject({ kind: "done" });
      expect(pressed).toEqual(next === "press" ? ["T2"] : []);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("reads and presses only the dropdown opened by its caret when another menu exists", async () => {
  using _clock = fakeTimers();
  const pressed: Array<string> = [];
  withMenu({ "Mute @theo": () => pressed.push("own") });
  document.querySelector("button")!.addEventListener("click", () => {
    const own = document.querySelector('[data-fake-menu] [role="menu"]')!;
    own.id = "own-menu";
    document.querySelector("button")!.setAttribute("aria-controls", own.id);
  });
  const foreign = document.createElement("div");
  foreign.innerHTML =
    '<div role="menu"><div data-testid="Dropdown"><div role="menuitem">Mute @theo</div><div role="menuitem">Foreign row</div></div></div>';
  foreign
    .querySelector('[role="menuitem"]')!
    .addEventListener("click", () => pressed.push("foreign"));
  document.body.prepend(foreign);
  const reading = xPostMenu(post42);
  await vi.runAllTimersAsync();
  expect(await reading).toEqual(["Mute @theo"]);
  expect(foreign.isConnected).toBe(true);
  const pressing = xPostMenuPress(post42, "Mute @theo", () => {});
  await vi.runAllTimersAsync();
  expect((await pressing)?.kind).toBe("done");
  expect(pressed).toEqual(["own"]);
});

it.each(["before", "during"])(
  "resumes paging requested %s a trend lookup without another native endReached",
  async (when) => {
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore");
    withMenu({});
    let bottoms = 0;
    using _scroll = vi.spyOn(window, "scrollTo").mockImplementation((...args) => {
      if (typeof args[0] !== "number") return;
      if (++bottoms === 2)
        document.querySelector("article a")!.setAttribute("href", "/theo/status/43");
    });
    using _back = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    try {
      const paging = when === "before" ? xScrollMore() : undefined;
      const reading = xTrendMenu("Missing");
      const pending = paging ?? xScrollMore();
      await vi.runAllTimersAsync();
      expect(await reading).toBeNull();
      expect(await pending).toBe(true);
      expect(bottoms).toBe(2);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("keeps paging while a post menu read waits for X's rows", async () => {
  using _clock = fakeTimers();
  withMenu({});
  let bottoms = 0;
  using _scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {
    if (++bottoms === 2)
      document.querySelector("article a")!.setAttribute("href", "/theo/status/43");
  });
  const reading = xPostMenu(post42);
  const paging = xScrollMore();
  await vi.advanceTimersByTimeAsync(600);
  expect(bottoms).toBe(2);
  expect(await paging).toBe(true);
  await vi.runAllTimersAsync();
  await reading;
});

it("sees X's next page of Community search results land and stops scrolling", async () => {
  using _clock = fakeTimers();
  const cell = (id: string) =>
    `<div data-testid="cellInnerDiv"><a href="/i/communities/${id}">Community ${id}</a></div>`;
  document.body.innerHTML = cell("1");
  inThisPage();
  let bottoms = 0;
  using _scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {
    if (++bottoms === 2) document.body.insertAdjacentHTML("beforeend", cell("2"));
  });
  using _back = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  try {
    const paging = xScrollMore();
    await vi.runAllTimersAsync();
    expect(await paging).toBe(true);
    expect(bottoms).toBe(2);
  } finally {
    registerXWebview(null);
  }
});

it("stops searching for a missing trend at the end of X's trend cells before the endless posts", async () => {
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore");
  document.body.innerHTML =
    '<div style="height:50000px"><div data-testid="trend" style="position:absolute;top:100px;height:100px"><span style="font-weight:700">Other trend</span></div></div>';
  inThisPage();
  try {
    const reading = xTrendMenu("Missing");
    await vi.runAllTimersAsync();
    expect(await reading).toBeNull();
    expect(window.scrollY).toBeLessThanOrEqual(201);
  } finally {
    window.scrollTo(0, 0);
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it.each(["post", "profile"])(
  "keeps overlapping %s menu reads in place when a newer read and screen change supersede them",
  async (kind) => {
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", kind === "profile" ? "/theo" : "/home");
    withMenu(
      { "First menu": () => {} },
      kind === "profile" ? '[data-testid="userActions"]' : '[data-testid="caret"]',
      kind === "profile"
        ? '<button data-testid="userActions"></button>'
        : '<button data-testid="caret"></button>',
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      '<article id="second"><a href="/ann/status/43"><time></time></a><button data-testid="caret"></button></article>',
    );
    document.querySelector("#second button")!.addEventListener("click", () => {
      drawMenu(document.querySelector("#second button")!, { "Second menu": () => {} });
    });
    inThisPage(() => "https://x.com/home");
    using navigation = vi.spyOn(history, "pushState");
    try {
      const first = kind === "profile" ? xProfileMenu("theo") : xPostMenu(post42);
      const second = xPostMenu({ postId: "43", handle: "ann" });
      xOverEnded();
      await vi.runAllTimersAsync();
      expect(navigation).not.toHaveBeenCalled();
      expect(await first).toEqual(["First menu"]);
      expect(await second).toEqual(["Second menu"]);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("closes a cancelled trend read's own dropdown while leaving the newer dropdown alone", async () => {
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore");
  withMenu({ "First menu": () => {} });
  const t1 = document.querySelector("article")!;
  t1.dataset.testid = "trend";
  t1.insertAdjacentHTML("afterbegin", '<span style="font-weight:700">T1</span>');
  const t2 = t1.cloneNode(true) as HTMLElement;
  t2.querySelector("span")!.textContent = "T2";
  let secondLayer: HTMLElement | undefined;
  t2.querySelector("button")!.addEventListener("click", () => {
    secondLayer = drawMenu(t2.querySelector("button")!, {});
  });
  document.body.append(t2);
  try {
    const first = xTrendMenu("T1");
    const firstMenu = document.querySelector('[role="menu"]')!;
    const second = xTrendMenu("T2");
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBeNull();
    expect(firstMenu.isConnected).toBe(false);
    expect(secondLayer!.isConnected).toBe(true);
    secondLayer!.querySelector('[data-testid="Dropdown"]')!.innerHTML =
      '<div role="menuitem">Second menu</div>';
    await vi.runAllTimersAsync();
    expect(await second).toEqual(["Second menu"]);
    expect(secondLayer!.isConnected).toBe(false);
  } finally {
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it.each([300, 2300])(
  "never presses another trend's row when its dropdown takes %s ms and a read intervenes",
  async (delay) => {
    using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore");
    document.body.innerHTML = ["A", "B"]
      .map(
        (name) =>
          `<div data-testid="trend"><span style="font-weight:700">${name}</span><button data-testid="caret" aria-haspopup="menu" aria-expanded="false">${name}</button></div>`,
      )
      .join("");
    const pressed: Array<string> = [];
    for (const caret of document.querySelectorAll("button"))
      caret.addEventListener("click", () => {
        const name = caret.textContent!;
        setTimeout(
          () => {
            drawMenu(caret, { "Not interested in this": () => pressed.push(name) });
          },
          name === "A" ? delay : 30,
        );
      });
    inThisPage();
    try {
      const pressing = xTrendMenuPress("A", "Not interested in this", () => {});
      await vi.advanceTimersByTimeAsync(50);
      const reading = xTrendMenu("B");
      await vi.runAllTimersAsync();
      expect(pressed).toEqual([]);
      expect(await pressing).toBeNull();
      expect(await reading).toEqual(["Not interested in this"]);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it.each(["error", "unmounted", "stale acknowledgement"])(
  "does not confirm dismissal from %s feedback",
  async (feedback) => {
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore");
    withMenu({
      "Not interested in this": () => {
        if (feedback === "unmounted") document.querySelector("article")!.remove();
        else if (feedback === "error")
          document.body.insertAdjacentHTML(
            "beforeend",
            '<div data-testid="toast">Something went wrong. Try again.</div>',
          );
      },
    });
    const trend = document.querySelector("article")!;
    trend.dataset.testid = "trend";
    trend.insertAdjacentHTML("afterbegin", '<span style="font-weight:700">A</span>');
    if (feedback === "stale acknowledgement")
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div data-testid="toast">Thanks<button>Undo</button></div>',
      );
    try {
      const pressing = xTrendMenuPress("A", "Not interested in this", () => {});
      await vi.runAllTimersAsync();
      expect(await pressing).toMatchObject({ kind: "done", dismissed: false, gone: false });
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it.each(["trend", "post", "profile"] as const)(
  "recovers asynchronous %s menu reads and presses after a timed-out dropdown closes",
  async (kind) => {
    using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", kind === "profile" ? "/theo" : "/explore");
    document.body.innerHTML = `<article data-testid="trend"><span style="font-weight:700">A</span><a href="/theo/status/42"><time></time></a><button data-testid="${kind === "profile" ? "userActions" : "caret"}" aria-haspopup="menu" aria-expanded="false"></button></article>`;
    let opens = 0;
    const pressed: Array<string> = [];
    document.querySelector("button")!.addEventListener("click", () => {
      opens++;
      // Post/profile reads can retry on their own page; both attempts must time out first.
      if (kind !== "trend" && opens === 2) return;
      const delay = opens === 1 ? (kind === "trend" ? 2300 : 4500) : 30;
      setTimeout(() => {
        drawMenu(document.querySelector("button")!, {
          "Requested row": () => pressed.push("Requested row"),
        });
      }, delay);
    });
    inThisPage(() => `https://x.com${location.pathname}`);
    const read = () =>
      kind === "trend"
        ? xTrendMenu("A")
        : kind === "post"
          ? xPostMenu(post42)
          : xProfileMenu("theo");
    try {
      const timedOut = read();
      await vi.advanceTimersByTimeAsync(kind === "trend" ? 2100 : 4100);
      expect(await timedOut).toBeNull();
      await vi.advanceTimersByTimeAsync(500);
      // The user may have closed the late menu before trying another native menu.
      document.querySelector<HTMLElement>("[data-fake-menu] > div")?.click();
      const retry = read();
      await vi.runAllTimersAsync();
      expect(await retry).toEqual(["Requested row"]);
      expect(pressed).toEqual([]);
      const pressing =
        kind === "trend"
          ? xTrendMenuPress("A", "Requested row", () => {})
          : kind === "post"
            ? xPostMenuPress(post42, "Requested row", () => {})
            : xProfileMenuPress("theo", "Requested row", () => {});
      await vi.runAllTimersAsync();
      expect((await pressing)?.kind).toBe("done");
      expect(pressed).toEqual(["Requested row"]);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("keeps a previous trend's toast and Undo from attaching to a press with no new feedback", async () => {
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore");
  const pressed: Array<string> = [];
  withMenu({
    "Not interested in this": () => {
      pressed.push("A");
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div data-testid="toast">Thanks<button>Undo</button></div>',
      );
    },
  });
  const a = document.querySelector("article")!;
  a.dataset.testid = "trend";
  a.insertAdjacentHTML("afterbegin", '<span style="font-weight:700">A</span>');
  const b = a.cloneNode(true) as HTMLElement;
  b.querySelector("span")!.textContent = "B";
  b.querySelector("button")!.addEventListener("click", () => {
    drawMenu(b.querySelector("button")!, { "Not interested in this": () => pressed.push("B") });
  });
  document.body.append(b);
  try {
    const first = xTrendMenuPress("A", "Not interested in this", () => {});
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({
      kind: "done",
      toast: "Thanks",
      undo: true,
      dismissed: true,
    });
    const second = xTrendMenuPress("B", "Not interested in this", () => {});
    await vi.runAllTimersAsync();
    expect(pressed).toEqual(["A", "B"]);
    expect(document.querySelector('[data-testid="toast"]')?.textContent).toBe("ThanksUndo");
    expect(await second).toMatchObject({
      kind: "done",
      toast: null,
      undo: false,
      dismissed: false,
    });
  } finally {
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it.each([100, 2100])(
  "leaves a user-opened X menu alone when its own caret never expands (%s ms)",
  async (when) => {
    using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(null, "", "/explore");
    document.body.innerHTML =
      '<div data-testid="trend"><span style="font-weight:700">A</span><button data-testid="caret" aria-haspopup="menu" aria-expanded="false"></button></div><button id="user" aria-haspopup="menu" aria-expanded="false"></button>';
    const user = document.querySelector("#user")!;
    let layer: HTMLElement | undefined;
    user.addEventListener("click", () => {
      layer = drawMenu(user, { "User menu": () => {} });
    });
    inThisPage();
    try {
      const reading = xTrendMenu("A");
      await vi.advanceTimersByTimeAsync(when);
      user.dispatchEvent(new MouseEvent("click"));
      await vi.runAllTimersAsync();
      expect(layer!.isConnected).toBe(true);
      expect(await reading).toBeNull();
      const retry = xTrendMenu("A");
      await vi.runAllTimersAsync();
      expect(await retry).toBeNull();
      expect(layer!.isConnected).toBe(true);
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("never claims A's late dropdown while B's caret is waiting to expand", async () => {
  using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore");
  document.body.innerHTML = ["A", "B"]
    .map(
      (name) =>
        `<div data-testid="trend"><span style="font-weight:700">${name}</span><button data-testid="caret" aria-haspopup="menu" aria-expanded="false">${name}</button></div>`,
    )
    .join("");
  const [a, b] = [...document.querySelectorAll("button")];
  const clicked: Array<string> = [];
  let late: HTMLElement | undefined;
  a!.addEventListener("click", () => {
    setTimeout(() => {
      late = drawMenu(a!, { "A row": () => clicked.push("A") });
    }, 2300);
  });
  const bClick = vi.fn();
  b!.addEventListener("click", bClick);
  inThisPage();
  try {
    const first = xTrendMenu("A");
    await vi.advanceTimersByTimeAsync(2100);
    expect(await first).toBeNull();
    const second = xTrendMenu("B");
    await vi.runAllTimersAsync();
    expect(bClick).toHaveBeenCalledOnce();
    expect(late!.isConnected).toBe(true);
    expect(await second).toBeNull();
    expect(clicked).toEqual([]);
    b!.addEventListener("click", () => drawMenu(b!, { "B row": () => clicked.push("B") }));
    const retry = xTrendMenuPress("B", "B row", () => {});
    await vi.runAllTimersAsync();
    expect(late!.isConnected).toBe(false);
    expect((await retry)?.kind).toBe("done");
    expect(clicked).toEqual(["B"]);
  } finally {
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it.each(["trend", "post", "profile"] as const)(
  "a dropdown that never mounts does not block later %s presses",
  async (kind) => {
    using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
    using _clock = fakeTimers();
    const path = location.pathname + location.search;
    history.replaceState(
      null,
      "",
      kind === "profile" ? "/theo" : kind === "post" ? "/theo/status/42" : "/explore",
    );
    document.body.innerHTML = `<article data-testid="trend"><span style="font-weight:700">A</span><a href="/theo/status/42"><time></time></a><button data-testid="${kind === "profile" ? "userActions" : "caret"}" aria-haspopup="menu" aria-expanded="false"></button></article>`;
    const caret = document.querySelector("button")!;
    const pressed: Array<string> = [];
    inThisPage(() => `https://x.com${location.pathname}`);
    try {
      const reading =
        kind === "trend"
          ? xTrendMenu("A")
          : kind === "post"
            ? xPostMenu(post42)
            : xProfileMenu("theo");
      await vi.runAllTimersAsync();
      await reading;
      caret.addEventListener("click", () =>
        drawMenu(caret, { "Requested row": () => pressed.push("own") }),
      );
      const pressing =
        kind === "trend"
          ? xTrendMenuPress("A", "Requested row", () => {})
          : kind === "post"
            ? xPostMenuPress(post42, "Requested row", () => {})
            : xProfileMenuPress("theo", "Requested row", () => {});
      await vi.runAllTimersAsync();
      expect(pressed).toEqual(["own"]);
      expect((await pressing)?.kind).toBe("done");
    } finally {
      history.replaceState(null, "", path);
      registerXWebview(null);
    }
  },
);

it("does not close a user reopening a previously clicked caret after its late menu closed", async () => {
  using _ownership = stubGlobal("__xtendMenuCarets", new WeakSet());
  using _clock = fakeTimers();
  const path = location.pathname + location.search;
  history.replaceState(null, "", "/explore");
  document.body.innerHTML = ["A", "B"]
    .map(
      (name) =>
        `<div data-testid="trend"><span style="font-weight:700">${name}</span><button data-testid="caret" aria-haspopup="menu" aria-expanded="false">${name}</button></div>`,
    )
    .join("");
  const a = document.querySelector("button")!;
  let opens = 0;
  let layer: HTMLElement | undefined;
  a.addEventListener("click", () => {
    if (++opens === 1)
      setTimeout(() => {
        layer = drawMenu(a, { "A row": () => {} });
      }, 2300);
    else layer = drawMenu(a, { "User reopened A": () => {} });
  });
  inThisPage();
  try {
    const reading = xTrendMenu("A");
    await vi.advanceTimersByTimeAsync(2400);
    expect(await reading).toBeNull();
    (layer!.firstElementChild as HTMLElement).click();
    a.click();
    const userMenu = layer!;
    const other = xTrendMenu("B");
    await vi.runAllTimersAsync();
    expect(await other).toBeNull();
    expect(userMenu.isConnected).toBe(true);
  } finally {
    history.replaceState(null, "", path);
    registerXWebview(null);
  }
});

it("pins and unpins only as the user clicked, on this Community's own Pin, and passes on X's toast", async () => {
  // Another Community's header, still drawn beside this one's, shows the state clicked for.
  const pinned = "Unpin Community from Home screen";
  document.body.innerHTML = header("12", "Join", pinned) + header("11", "Join", pinned);
  const pressed: Array<string> = [];
  // X shows one toast at a time.
  const toast = (text: string) => {
    document.querySelector('[data-testid="toast"]')?.remove();
    const el = document.createElement("div");
    el.dataset.testid = "toast";
    el.textContent = text;
    document.body.append(el);
  };
  // X unpins at once; a pin it refuses, at the user's limit of pinned Timelines, with its toast.
  for (const button of document.querySelectorAll<HTMLElement>('[aria-label^="Unpin"]'))
    button.addEventListener("click", () => {
      const was = button.getAttribute("aria-label")!;
      pressed.push(was);
      if (was === pinned) {
        button.setAttribute("aria-label", "Pin Community");
        toast("Unpinned");
      } else toast("You’ll need to remove one pinned Timeline before adding another");
    });
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    history.replaceState(null, "", "/i/communities/11");
    // Xtend still says Pin (the user pinned it on x.com since): nothing is pressed, X's word stands.
    expect(await xCommunityPin("11", true, () => {})).toEqual({
      refused: true,
      label: pinned,
      toast: null,
    });
    expect(pressed).toEqual([]);
    expect(await xCommunityPin("11", false, () => {})).toEqual({
      refused: false,
      label: "Pin Community",
      toast: "Unpinned",
    });
    // Pressed, and X kept it unpinned: what X's button says is what holds.
    expect(await xCommunityPin("11", true, () => {})).toEqual({
      refused: false,
      label: "Pin Community",
      toast: "You’ll need to remove one pinned Timeline before adding another",
    });
    expect(pressed).toEqual([pinned, "Pin Community"]);
    expect(pinLabel(document, "/i/communities/12", "12")).toBe(pinned);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("keeps what X's Pin says after the press, even once a later press has started", async () => {
  using _clock = fakeTimers();
  document.body.innerHTML = header("11", "Join");
  const pin = document.querySelector<HTMLElement>('[aria-label="Pin Community"]')!;
  pin.addEventListener("click", () => pin.setAttribute("aria-label", "Unpin"));
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    history.replaceState(null, "", "/i/communities/11");
    const pinning = xCommunityPin("11", true, () => {});
    // X took the press; then the user starts another one before X's save went out.
    await vi.advanceTimersByTimeAsync(300);
    expect(pin.getAttribute("aria-label")).toBe("Unpin");
    xOverEnded();
    await vi.runAllTimersAsync();
    expect(await pinning).toEqual({ refused: false, label: "Unpin", toast: null });
  } finally {
    history.replaceState(null, "", start);
  }
});

// X's List header (bundle.UserLists' ListDetail): counts linking its people, then its Follow,
// which X gives no test id; and a row of X's Lists page with its Pin, drawn anchorless.
const listHeader = (id: string, label: string) =>
  `<div><h2>L${id}</h2><a href="/i/lists/${id}/members"><b>3</b> Members</a><a href="/i/lists/${id}/followers"><b>9</b> Followers</a><button role="button"><span>${label}</span></button></div>`;
const listRow = (name: string, pin: string) =>
  `<div data-testid="listCell" role="link"><div><span>${name}</span></div><div>3 members</div><button data-testid="list-icon-button" aria-label="${pin}"></button></div>`;
/**
 * X's rows under `root`, each given its List as React holds it: the cell's element, then the
 * cell's component with its `link`, then the element holding the cell.
 */
const linked = <R extends ParentNode>(root: R, ...ids: ReadonlyArray<string>) => {
  root.querySelectorAll('[data-testid="listCell"]').forEach((cell, i) =>
    Reflect.set(cell, "__reactFiber$test", {
      stateNode: cell,
      memoizedProps: { className: "cell" },
      return: {
        memoizedProps: { link: { pathname: `/i/lists/${ids[i]}`, anchorless: true } },
        return: { stateNode: cell.parentElement, memoizedProps: {}, return: null },
      },
    }),
  );
  return root;
};
const makers = { listId: "12", name: "Makers" };

it("finds a List's Follow only in its own header on its page, and its Pin only in the row X rendered for it", () => {
  const follow = (root: ParentNode, path: string) =>
    listButton(root, path, makers, "follow")?.textContent ?? null;
  const pin = (root: ParentNode, path: string, list = makers) =>
    listButton(root, path, list, "pin")?.getAttribute("aria-label") ?? null;
  const twelve = page(listHeader("12", "Following"));
  expect(follow(twelve, "/i/lists/12")).toBe("Following");
  // X moved to the List's members, or to List 120, with 12's header still drawn: not its page.
  expect([follow(twelve, "/i/lists/12/members"), follow(twelve, "/i/lists/120")]).toEqual([
    null,
    null,
  ]);
  // A person's Follow (X's test id) beside the List's counts is never the List's.
  expect(
    follow(
      page(
        `<a href="/i/lists/12/members">3</a><div><button data-testid="7-follow">Follow</button></div>`,
      ),
      "/i/lists/12",
    ),
  ).toBeNull();
  const rows = linked(
    page(listRow("Other", "Unpin List") + listRow("Makers", "Pin List")),
    "13",
    "12",
  );
  expect([pin(rows, "/you/lists"), pin(rows, "/you/lists/"), pin(rows, "/i/lists/12")]).toEqual([
    "Pin List",
    "Pin List",
    null,
  ]);
  // X draws only the rows near its scroll. With 12's row not drawn, no other row is its: not one of
  // the same name, nor one whose member count reads as 12's name, nor a row React gave no List.
  expect(pin(linked(page(listRow("Makers", "Unpin List")), "13"), "/you/lists")).toBeNull();
  expect(
    pin(linked(page(listRow("Other", "Pin List")), "13"), "/you/lists", {
      listId: "12",
      name: "3 members",
    }),
  ).toBeNull();
  expect(pin(page(listRow("Makers", "Pin List")), "/you/lists")).toBeNull();
  // A link above the element holding the cell is some other component's, not the cell's.
  const loose = page(listRow("Makers", "Pin List"));
  const cell = loose.querySelector('[data-testid="listCell"]')!;
  Reflect.set(cell, "__reactFiber$test", {
    stateNode: cell,
    memoizedProps: {},
    return: {
      stateNode: cell.parentElement,
      memoizedProps: {},
      return: { memoizedProps: { link: { pathname: "/i/lists/12" } }, return: null },
    },
  });
  expect(pin(loose, "/you/lists")).toBeNull();
  // A cell drawn inside another: the inner cell's Pin is its own List's, never the outer's.
  const nested = linked(
    page(`<div data-testid="listCell" role="link">${listRow("Inner", "Pin List")}</div>`),
    "12",
    "13",
  );
  expect([
    pin(nested, "/you/lists"),
    pin(nested, "/you/lists", { listId: "13", name: "Inner" }),
  ]).toEqual([null, "Pin List"]);
});

it("follows and pins a List only as the user clicked, on X's own buttons, and passes on X's toast", async () => {
  document.body.innerHTML = listHeader("12", "Follow");
  const pressed: Array<string> = [];
  const follow = document.querySelector<HTMLElement>("button")!;
  follow.addEventListener("click", () => {
    pressed.push(follow.textContent!);
    follow.querySelector("span")!.textContent = "Following";
  });
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    history.replaceState(null, "", "/i/lists/12");
    // Xtend still says Following (the user unfollowed on x.com since): nothing is pressed.
    expect(await xListFollow(makers, false, () => {})).toEqual({
      refused: true,
      label: "Follow",
      toast: null,
    });
    expect(await xListFollow(makers, true, () => {})).toEqual({
      refused: false,
      label: "Following",
      toast: null,
    });
    // X's Pin at its limit of pinned Timelines: X keeps the List unpinned and says why.
    document.body.innerHTML = listRow("Makers", "Pin List");
    linked(document.body, "12");
    document.querySelector("[data-testid=list-icon-button]")!.addEventListener("click", () => {
      pressed.push("Pin List");
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div data-testid="toast">You’ll need to remove one pinned Timeline before adding another</div>`,
      );
    });
    history.replaceState(null, "", "/you/lists");
    expect(await xListPin(makers, "you", true, () => {})).toEqual({
      refused: false,
      label: "Pin List",
      toast: "You’ll need to remove one pinned Timeline before adding another",
    });
    expect(pressed).toEqual(["Follow", "Pin List"]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("keeps X's List dialog over the main area through each of its steps, and says where X settled", async () => {
  using _clock = fakeTimers();
  document.body.innerHTML = "";
  const start = location.pathname + location.search;
  const shown: Array<boolean> = [];
  inThisPage(() => `https://x.com${location.pathname}`);
  try {
    const dialog = xListDialog(null, (on) => shown.push(on));
    await vi.advanceTimersByTimeAsync(1000);
    expect([location.pathname, shown]).toEqual(["/i/lists/create", [true]]);
    // Next: X's Add to your List, a page of its own in the engine's narrow window.
    history.replaceState(null, "", "/i/lists/77/members/suggested");
    await vi.advanceTimersByTimeAsync(600);
    expect(shown).toEqual([true]);
    // Done: X opens the new List.
    history.replaceState(null, "", "/i/lists/77");
    await vi.advanceTimersByTimeAsync(600);
    expect([await dialog, shown]).toEqual(["/i/lists/77", [true, false]]);
    // Edit List finished at once (Delete List, then X's Lists page): still X's dialog come and gone.
    const edit = xListDialog("77", (on) => shown.push(on));
    await vi.advanceTimersByTimeAsync(0);
    history.replaceState(null, "", "/you/lists/");
    await vi.advanceTimersByTimeAsync(600);
    expect([await edit, shown]).toEqual(["/you/lists/", [true, false, true, false]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("shows X's List dialog over no other screen when the user leaves while X's route is still coming", async () => {
  document.body.innerHTML = "";
  const start = location.pathname + location.search;
  const shown: Array<boolean> = [];
  // X's router takes its time: the move to X's route waits until the test lets it through.
  let asked: () => void = () => {};
  const moving = new Promise<void>((resolve) => (asked = resolve));
  let release: () => void = () => {};
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${location.pathname}`,
    executeJavaScript: (code: string) =>
      code.includes("pushState")
        ? (asked(),
          new Promise((resolve) => (release = () => resolve(new Function(`return ${code}`)()))))
        : Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  try {
    const dialog = xListDialog(null, (on) => shown.push(on));
    await moving;
    // The user opens another screen (AppShell ends X's place over the main area), then X moves.
    xOverEnded();
    release();
    expect([await dialog, shown]).toEqual([null, []]);
  } finally {
    history.replaceState(null, "", start);
    registerXWebview(null);
  }
});

it("picks X's search tab only on the Community search it was asked for, and gives up once the user moved on", async () => {
  using _clock = fakeTimers();
  const open = () => new AbortController().signal;
  const clicked: Array<string> = [];
  const draw = () => {
    document.body.innerHTML = `<nav><div role="tab" aria-selected="true">Top</div><div role="tab" aria-selected="false">Latest</div></nav>`;
    for (const tab of document.querySelectorAll('[role="tab"]'))
      tab.addEventListener("click", () => clicked.push(tab.textContent!));
  };
  inThisPage(() => `https://x.com${location.pathname}${location.search}`);
  const start = location.href;
  try {
    // Another Community's search, with its own Latest: not this one's.
    history.replaceState(null, "", "/i/communities/12/search?q=ship");
    draw();
    const other = xPickCommunitySearchTab("11", "ship", "Latest", Promise.resolve(), open());
    await vi.runAllTimersAsync();
    expect([await other, clicked]).toEqual([false, []]);
    // This search is still loading when the user moves on: X's tabs drawn after are not pressed.
    history.replaceState(null, "", "/i/communities/11/search?q=ship");
    document.body.innerHTML = "";
    const left = xPickCommunitySearchTab("11", "ship", "Latest", Promise.resolve(), open());
    await vi.advanceTimersByTimeAsync(300);
    xOverEnded();
    draw();
    await vi.runAllTimersAsync();
    expect([await left, clicked]).toEqual([false, []]);
    // Asked as X starts loading the page: nothing is pressed before that load settles, and the
    // screen letting the page go meanwhile (another order, a reload, leaving) ends it.
    let loaded = () => {};
    const screen = new AbortController();
    const loading = xPickCommunitySearchTab(
      "11",
      "ship",
      "Latest",
      new Promise<void>((r) => (loaded = r)),
      screen.signal,
    );
    await vi.runAllTimersAsync();
    expect(clicked).toEqual([]);
    screen.abort();
    loaded();
    await vi.runAllTimersAsync();
    expect([await loading, clicked]).toEqual([false, []]);
    // Another screen's step ending meanwhile (the app shell on start-up) does not end it.
    document.body.innerHTML = "";
    let started = () => {};
    const starting = xPickCommunitySearchTab(
      "11",
      "ship",
      "Latest",
      new Promise<void>((r) => (started = r)),
      open(),
    );
    xOverEnded();
    started();
    draw();
    await vi.runAllTimersAsync();
    expect([await starting, clicked]).toEqual([true, ["Latest"]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

/** Puts this document's URL back as it was, once the test is done with X's routes. */
const keepUrl = (): Disposable => {
  const start = location.href;
  return { [Symbol.dispose]: () => history.replaceState(null, "", start) };
};

/**
 * X's composer and its GIF search on this document's URL: the search on its own route (a dialog,
 * or the page at the engine's width), a history entry per query, so one Back steps back a query.
 * A Back lands `backMs` later; X removes the search `lingerMs` after leaving; `stuck` ignores Back.
 */
function fakeGifSearch({
  layout = "page",
  who = "search",
  backMs = 100,
  lingerMs = 0,
  stuck = false,
}: {
  readonly layout?: "dialog" | "page";
  readonly who?: string;
  readonly backMs?: number;
  readonly lingerMs?: number;
  readonly stuck?: boolean;
} = {}) {
  for (const key of ["__xtendGif", "__xtendGifLive"]) Reflect.deleteProperty(window, key);
  history.replaceState(null, "", "/home");
  const home = `<header><button data-testid="app-bar-back">page back</button></header>
    <main><div data-testid="toolBar"><button data-testid="gifSearchButton" aria-label="Add a GIF"></button></div></main>`;
  document.body.innerHTML = home;
  const x = { opened: 0, typed: [] as Array<string>, backs: [] as Array<string>, stuck };
  document.querySelector("header button")!.addEventListener("click", () => x.backs.push("page"));
  document.querySelector('[data-testid="gifSearchButton"]')!.addEventListener("click", () => {
    x.opened++;
    // X draws its search a moment after the press.
    setTimeout(() => {
      history.replaceState(null, "", "/i/foundmedia/search");
      const search = `<div class="bar"><button data-testid="app-bar-back">back</button></div><div><input placeholder="Search for GIFs"></div><div data-testid="gifSearchGifImage" style="background-image:url(/media/g1/200_d.gif)"></div>`;
      if (layout === "dialog")
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div role="dialog" data-who="${who}">${search}</div>`,
        );
      else document.body.innerHTML = `<main data-who="${who}">${search}</main>`;
      const view = document.querySelector(`[data-who="${who}"]`)!;
      const field = view.querySelector("input")!;
      const queries: Array<string> = [];
      field.addEventListener("input", () => {
        x.typed.push(field.value);
        queries.push(field.value);
      });
      view.querySelector("button")!.addEventListener("click", () => {
        x.backs.push(who);
        if (x.stuck) return;
        setTimeout(() => {
          if (queries.pop() !== undefined) field.value = queries.at(-1) ?? "";
          else {
            history.replaceState(null, "", "/home");
            setTimeout(() => {
              if (layout === "dialog") view.remove();
              else document.body.innerHTML = home;
            }, lingerMs);
          }
        }, backMs);
      });
    }, 300);
  });
  return x;
}

it.each(["dialog", "page"] as const)(
  "opens X's GIF search once from X's own button, types each query as X sees typing, and leaves it a query at a time with its own Back (%s)",
  async (layout) => {
    using _clock = fakeTimers();
    using _url = keepUrl();
    const x = fakeGifSearch({ layout });
    inThisPage(() => "https://x.com/home");

    const picker = xGifPicker();
    const searches = [picker.search(""), picker.search("ca"), picker.search("cat")];
    await vi.runAllTimersAsync();
    expect([await Promise.all(searches), x.opened, x.typed]).toEqual([
      [true, true, true],
      1,
      ["ca", "cat"],
    ]);
    const closing = picker.close();
    await vi.runAllTimersAsync();
    // "cat", then "ca", then the search X opened on.
    expect([await closing, x.backs, location.pathname]).toEqual([
      true,
      ["search", "search", "search"],
      "/home",
    ]);
    expect(document.querySelector('input[placeholder="Search for GIFs"]')).toBeNull();
    // With X's search gone, closing again presses nothing, the page's own Back included.
    const again = picker.close();
    await vi.runAllTimersAsync();
    expect([await again, x.backs.length]).toEqual([false, 3]);
  },
);

it("presses Back only while X is on its search, however late X removes it, and as often as its queries need", async () => {
  using _clock = fakeTimers();
  using _url = keepUrl();
  // X takes a while to take each Back, and draws its search a while longer after leaving it.
  const slow = fakeGifSearch({ backMs: 400, lingerMs: 2_000 });
  inThisPage(() => "https://x.com/home");
  const picker = xGifPicker();
  void picker.search("cat");
  await vi.runAllTimersAsync();
  const closing = picker.close();
  await vi.runAllTimersAsync();
  expect([await closing, slow.backs, location.pathname]).toEqual([
    true,
    ["search", "search"],
    "/home",
  ]);

  // Nine queries are nine history entries: ten Backs to leave.
  const many = fakeGifSearch();
  const typing = xGifPicker();
  for (const query of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) void typing.search(query);
  await vi.runAllTimersAsync();
  const leaving = typing.close();
  await vi.runAllTimersAsync();
  expect([await leaving, many.backs.length, location.pathname]).toEqual([true, 10, "/home"]);
});

it("keeps X's search its own when X does not take its Back, so a later close still leaves it", async () => {
  using _clock = fakeTimers();
  using _url = keepUrl();
  const x = fakeGifSearch({ stuck: true });
  inThisPage(() => "https://x.com/home");
  const picker = xGifPicker();
  void picker.search("cat");
  await vi.runAllTimersAsync();
  const closing = picker.close();
  await vi.runAllTimersAsync();
  // One Back X never took; nothing more is pressed, and X is still on its search.
  expect([await closing, x.backs, location.pathname]).toEqual([
    false,
    ["search"],
    "/i/foundmedia/search",
  ]);
  // X answers again: the same picker can still leave its search.
  x.stuck = false;
  const again = picker.close();
  await vi.runAllTimersAsync();
  expect([await again, x.backs.length, location.pathname]).toEqual([true, 3, "/home"]);
});

it("a GIF picker closed while X's next page is still coming stops at once, so Post goes next, and never closes a search it did not open", async () => {
  using _clock = fakeTimers();
  using _url = keepUrl();
  const x = fakeGifSearch({ layout: "dialog", who: "picker" });
  inThisPage(() => "https://x.com/home");
  const picker = xGifPicker();
  const opened = picker.search("");
  await vi.advanceTimersByTimeAsync(300);
  expect(await opened).toBe(true);
  // At the grid's end; X has not sent its next page yet.
  void picker.more();
  await vi.advanceTimersByTimeAsync(400);

  // The user picks a GIF, which closes the picker, and presses Post at once.
  void picker.close();
  let postMayStart = false;
  void xGifIdle().then(() => (postMayStart = true));
  await vi.advanceTimersByTimeAsync(500);
  expect([postMayStart, x.backs]).toEqual([true, ["picker"]]);

  // Another picker's search is open when the desktop's Post loads X's page afresh and opens X's
  // search in its composer: that picker closing afterwards leaves the desktop's search alone.
  fakeGifSearch({ layout: "dialog", who: "other" });
  const other = xGifPicker();
  void other.search("");
  await vi.advanceTimersByTimeAsync(300);
  const desktop = fakeGifSearch({ layout: "dialog", who: "desktop" });
  (document.querySelector('[data-testid="gifSearchButton"]') as HTMLElement).click();
  await vi.advanceTimersByTimeAsync(300);
  void other.close();
  await vi.runAllTimersAsync();
  expect([desktop.backs, document.querySelector('[data-who="desktop"]') !== null]).toEqual([
    [],
    true,
  ]);
});

it("presses X's Inspiration filter as a pointer's whole press, only that filter, only on X's Inspiration", async () => {
  using _clock = fakeTimers();
  const pressed: Array<string> = [];
  // X's Creator Studio buttons act on a pointer's press: a bare click() does nothing.
  const draw = () => {
    document.body.innerHTML = ["💬 EN", "Last 24h", "Last 7d", "Most Likes", "Most Replies"]
      .map((label) => `<button type="button">${label}</button>`)
      .join("");
    for (const button of document.querySelectorAll("button")) {
      let down = false;
      button.addEventListener(
        "pointerdown",
        (e) => (down = e.isPrimary && e.pointerType === "mouse"),
      );
      button.addEventListener("click", () => down && pressed.push(button.textContent!));
    }
  };
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    draw();
    history.replaceState(null, "", "/i/jf/creators/studio");
    const open = new AbortController().signal;
    const away = xPickInspiration("period", "Last 7d", Promise.resolve(), open);
    await vi.runAllTimersAsync();
    expect([await away, pressed]).toEqual([false, []]);
    history.replaceState(null, "", "/i/jf/creators/inspiration/top_posts");
    const picked = xPickInspiration("period", "Last 7d", Promise.resolve(), open);
    await vi.runAllTimersAsync();
    expect([await picked, pressed]).toEqual([true, ["Last 7d"]]);
    // Picked while X still draws its buttons: an engagement and a period both reach X, in order,
    // and a second period still waiting its turn replaces the first.
    pressed.length = 0;
    document.body.innerHTML = "";
    const picks = [
      xPickInspiration("engagement", "Most Replies", Promise.resolve(), open),
      xPickInspiration("period", "Last 7d", Promise.resolve(), open),
      xPickInspiration("period", "Last 24h", Promise.resolve(), open),
    ];
    await vi.advanceTimersByTimeAsync(300);
    draw();
    await vi.runAllTimersAsync();
    expect([await Promise.all(picks), pressed]).toEqual([
      [true, false, true],
      ["Most Replies", "Last 24h"],
    ]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("lets later Inspiration picks run once the screen or X's next page load lets a stuck press go", async () => {
  using _clock = fakeTimers();
  // A full load of X's page under a waiting press script: the webview never settles that script.
  const pressed: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/i/jf/creators/inspiration/top_posts",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      const label = /"(Last 7d|Last 30d|Most Likes|Most Quotes)"/.exec(code)?.[1];
      if (label === undefined) return Promise.resolve(true);
      pressed.push(label);
      return label.startsWith("Last") ? new Promise(() => {}) : Promise.resolve(true);
    },
  } as unknown as XWebview);
  markXReady();
  const outcome = (press: Promise<boolean>) => {
    const seen: { value?: boolean } = {};
    void press.then((value) => (seen.value = value));
    return seen;
  };
  const screen = new AbortController();
  const left = outcome(xPickInspiration("period", "Last 7d", Promise.resolve(), screen.signal));
  await vi.runAllTimersAsync();
  screen.abort();
  const after = outcome(
    xPickInspiration("engagement", "Most Likes", Promise.resolve(), new AbortController().signal),
  );
  await vi.runAllTimersAsync();
  expect([left.value, after.value]).toEqual([false, true]);

  const open = new AbortController().signal;
  const reloaded = outcome(xPickInspiration("period", "Last 30d", Promise.resolve(), open));
  await vi.runAllTimersAsync();
  markXReady();
  const next = outcome(xPickInspiration("engagement", "Most Quotes", Promise.resolve(), open));
  await vi.runAllTimersAsync();
  expect([reloaded.value, next.value, pressed]).toEqual([
    false,
    true,
    ["Last 7d", "Most Likes", "Last 30d", "Most Quotes"],
  ]);
  registerXWebview(null);
});

it("picks a tab only on the page it was asked on, or under it, never another page's tab of that name", async () => {
  using _clock = fakeTimers();
  const clicked: Array<string> = [];
  const draw = (labels: ReadonlyArray<string>) => {
    document.body.innerHTML = `<nav>${labels.map((l) => `<a role="tab" aria-selected="false">${l}</a>`).join("")}</nav>`;
    for (const tab of document.querySelectorAll('[role="tab"]'))
      tab.addEventListener("click", () => clicked.push(`${location.pathname} ${tab.textContent}`));
  };
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    // Home's Following, asked before X drew Home: the engine moves on to a profile's people pages,
    // whose Following tab is not Home's.
    history.replaceState(null, "", "/home");
    document.body.innerHTML = "";
    const home = xPickHomeTab("Following");
    await vi.advanceTimersByTimeAsync(300);
    history.replaceState(null, "", "/ann/verified_followers");
    draw(["Verified Followers", "Followers", "Following"]);
    await vi.runAllTimersAsync();
    expect([await home, clicked]).toEqual([false, []]);
    // A page X moves under once it loads (Explore's own tabs) is still that page.
    history.replaceState(null, "", "/explore");
    document.body.innerHTML = "";
    const explore = xPickHomeTab("News");
    history.replaceState(null, "", "/explore/tabs/for_you");
    draw(["For You", "News"]);
    await vi.runAllTimersAsync();
    expect([await explore, clicked]).toEqual([true, ["/explore/tabs/for_you News"]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("picks a game's tab once X answered for that game since the engine's last move, whoever picks it", async () => {
  using _clock = fakeTimers();
  const answer = (op: string, key: string) => xHeard({ op, key } as unknown as EngineBatch);
  const open = () => new AbortController().signal;
  const clicked: Array<string> = [];
  // The last game's tabs, still drawn while X's path already names the next game.
  document.body.innerHTML = `<nav><div role="tab" aria-selected="true">Top</div><div role="tab" aria-selected="false">Latest</div></nav>`;
  for (const tab of document.querySelectorAll('[role="tab"]'))
    tab.addEventListener("click", () => clicked.push(tab.textContent!));
  inThisPage(() => `https://x.com${location.pathname}`);
  // The engine moves to game `id`, as a game screen's load does.
  const move = (id: string) => {
    history.replaceState(null, "", `/i/nba/game/${id}`);
    return xNavigate(`https://x.com/i/nba/game/${id}`);
  };
  const start = location.href;
  try {
    const moved = xPickGameTab("42", "Latest", move("42"), open());
    await vi.advanceTimersByTimeAsync(1_000);
    answer("NBAGameHydrate", "41");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clicked).toEqual([]);
    answer("NBAGameHydrate", "42");
    await vi.runAllTimersAsync();
    expect([await moved, clicked]).toEqual([true, ["Latest"]]);
    // In place: X answered for this game since the engine moved there.
    const inPlace = xPickGameTab("42", "Latest", Promise.resolve(false), open());
    await vi.runAllTimersAsync();
    expect([await inPlace, clicked]).toEqual([true, ["Latest", "Latest"]]);
    // X stays quiet after a move: nothing is pressed.
    const quiet = xPickGameTab("42", "Latest", move("42"), open());
    await vi.runAllTimersAsync();
    expect([await quiet, clicked]).toEqual([false, ["Latest", "Latest"]]);
    // Latest clicked after the move to 43, before X answers for it: the URL already names 43, but
    // the tabs drawn are still 42's. Every pick waits for X's answer for 43, then presses.
    clicked.length = 0;
    const top = new AbortController();
    const opening = xPickGameTab("43", "Top", move("43"), top.signal);
    await vi.advanceTimersByTimeAsync(500);
    top.abort();
    const latest = xPickGameTab("43", "Latest", Promise.resolve(false), open());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clicked).toEqual([]);
    answer("SportsGameTopTimeline", "43");
    await vi.runAllTimersAsync();
    expect([await opening, await latest, clicked]).toEqual([false, true, ["Latest"]]);
    // A finished game X answered once, before any pick: Latest in place is pressed at once.
    clicked.length = 0;
    void move("44");
    answer("NBAGameHydrate", "44");
    const finished = xPickGameTab("44", "Latest", Promise.resolve(false), open());
    await vi.advanceTimersByTimeAsync(0);
    expect([await finished, clicked]).toEqual([true, ["Latest"]]);
    // Back to game 44 after a move away: X's router serves it from its cache with no new answer,
    // and its score hero names 44's teams, so Latest is pressed. A hero naming another game's
    // teams (X still drawing the last one) is not 44's.
    const teams = {
      away: { name: "Toronto Raptors", abbreviation: "TOR" },
      home: { name: "Los Angeles Lakers", abbreviation: "LAL" },
    };
    const hero = (away: string, home: string) =>
      document.body.insertAdjacentHTML(
        "afterbegin",
        `<div data-testid="nflGameScoreHero"><div data-testid="nflGameScoreHeroAwayTeam">${away}</div><div data-testid="nflGameScoreHeroScore">82 - 104</div><div data-testid="nflGameScoreHeroHomeTeam">${home}</div></div>`,
      );
    clicked.length = 0;
    void xNavigate("https://x.com/lakers");
    hero("Boston Celtics", "Orlando Magic");
    const stale = xPickGameTab("44", "Latest", move("44"), open(), teams);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(clicked).toEqual([]);
    document.querySelector('[data-testid="nflGameScoreHero"]')!.remove();
    hero("Raptors", "Lakers");
    await vi.runAllTimersAsync();
    expect([await stale, clicked]).toEqual([true, ["Latest"]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("presses X's analytics range only on the page asked for once X draws it, and reads X's upsell", async () => {
  using _clock = fakeTimers();
  const pressed: Array<string> = [];
  const draw = (heading: string) => {
    document.body.innerHTML = `<h2>${heading}</h2>${["7D", "4W"]
      .map((label) => `<button type="button">${label}</button>`)
      .join("")}`;
    for (const b of document.querySelectorAll("button"))
      b.addEventListener("click", () => pressed.push(`${heading} ${b.textContent}`));
  };
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    const open = new AbortController().signal;
    // X's URL already names Content while its router still draws Overview's buttons.
    history.replaceState(null, "", "/i/account_analytics/content");
    draw("Account overview");
    const early = xPickAnalyticsRange(
      "/i/account_analytics/content",
      "4W",
      Promise.resolve(),
      open,
    );
    await vi.runAllTimersAsync();
    expect([await early, pressed]).toEqual([false, []]);
    // Once X draws Content, its own button.
    const late = xPickAnalyticsRange("/i/account_analytics/content", "4W", Promise.resolve(), open);
    await vi.advanceTimersByTimeAsync(300);
    draw("Date");
    await vi.runAllTimersAsync();
    expect([await late, pressed]).toEqual([true, ["Date 4W"]]);

    // X's page shows its analytics, or its upsell over the page.
    history.replaceState(null, "", "/i/account_analytics");
    draw("Account overview");
    expect(await xAnalyticsUpsell("/i/account_analytics", Promise.resolve(), open)).toBe(false);
    document.body.innerHTML = `<div role="dialog"><h2>Advanced analytics with Plus</h2><p>See your profile analytics, understand your audience and more. Upgrade to continue.</p><button>Maybe later</button></div>`;
    expect(await xAnalyticsUpsell("/i/account_analytics", Promise.resolve(), open)).toBe(true);

    // X's selected range is its button in X's primary style, the one way X's page marks it.
    const ranges = (shown: string) =>
      (document.body.innerHTML = `<h2>Account overview</h2>${["7D", "4W"]
        .map(
          (l) =>
            `<button class="${l === shown ? "bg-btn-primary" : "border-normal"}">${l}</button>`,
        )
        .join("")}`);
    ranges("7D");
    expect(
      await xAnalyticsSelected("/i/account_analytics", ["7D", "4W"], Promise.resolve(), open),
    ).toBe("7D");
    // Just after a press X still draws the old range for a moment: the read waits for it.
    const after = xAnalyticsSelected(
      "/i/account_analytics",
      ["7D", "4W"],
      Promise.resolve(),
      open,
      "4W",
    );
    await vi.advanceTimersByTimeAsync(300);
    ranges("4W");
    await vi.runAllTimersAsync();
    expect(await after).toBe("4W");
  } finally {
    history.replaceState(null, "", start);
  }
});

it("presses Delete Folder only in the editor X shows for that folder, never another folder's", async () => {
  using _clock = fakeTimers();
  const start = location.pathname + location.search;
  const pressed: Array<string> = [];
  // X's Edit Folder: its name field, then its red row.
  const editor = (name: string) => {
    document.body.innerHTML = `<div role="dialog"><input value="${name}"><div><span>Delete Folder</span></div></div>`;
    document.querySelector("span")!.addEventListener("click", () => pressed.push(name));
  };
  inThisPage(() => `https://x.com${location.pathname}`);
  // X is on this folder's route while the last folder's editor is still drawn.
  editor("Ideas");
  try {
    const shown = xFolderDialog({ folderId: "801", name: "Reading" }, true, () => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect([location.pathname, pressed]).toEqual(["/i/bookmarks/801/edit", []]);
    editor("Reading");
    await vi.advanceTimersByTimeAsync(200);
    expect(pressed).toEqual(["Reading"]);
    // The user confirmed in X's sheet: X leaves the route.
    history.replaceState(null, "", start);
    await vi.advanceTimersByTimeAsync(600);
    expect(await shown).toBe(true);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("creates a Radar query through X's own form: the query typed into X's field, then X's own Submit once X turns it on", async () => {
  using _clock = fakeTimers();
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  // X's form: Submit (its arrow) is off until X's field has text, and X opens the query's page.
  document.body.innerHTML = `<main><input placeholder="$NVDA (sell OR buy)"><button disabled><svg data-icon="icon-arrow-up"></svg></button></main>`;
  const input = document.querySelector("input")!;
  const submit = document.querySelector("button")!;
  input.addEventListener("input", () =>
    setTimeout(() => (submit.disabled = input.value === ""), 100),
  );
  const sent: Array<string> = [];
  submit.addEventListener("click", () => {
    sent.push(input.value);
    history.pushState(null, "", "/i/radar/1803");
  });
  try {
    const created = xRadarCreate("$NVDA (sell OR buy)");
    await vi.runAllTimersAsync();
    expect([await created, sent]).toEqual(["1803", ["$NVDA (sell OR buy)"]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("presses X's Delete only on the one row whose query field is exactly the query, and shows X's dialog until the user closes it", async () => {
  using _clock = fakeTimers();
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  // X's row: a column of its title and date, its query field (the query, or tags one by one), and
  // its actions with Delete's label.
  const row = (title: string, ...query: Array<string>) =>
    `<div class="group"><div><div><div>${title}</div><span>Oct 28</span></div><div>${query.map((q) => `<div><span>${q}</span></div>`).join("")}</div><div><button><svg data-icon="icon-trashcan"></svg><div>Delete</div></button></div></div><div>Posts 12</div></div>`;
  const pressed: Array<number> = [];
  const list = (...rows: Array<string>) => {
    document.body.innerHTML = `<main>${rows.join("")}</main>`;
    document.querySelectorAll("main button").forEach((b, i) =>
      b.addEventListener("click", () => {
        pressed.push(i);
        document.body.insertAdjacentHTML("beforeend", `<div role="dialog"></div>`);
      }),
    );
  };
  const over: Array<boolean> = [];
  const show = (shown: boolean) => over.push(shown);
  const none = async (query: string, ...rows: Array<string>) => {
    list(...rows);
    const deleted = xRadarDelete({ title: "", query }, show);
    await vi.runAllTimersAsync();
    return deleted;
  };
  try {
    // Delete's own label, a title, part of a query, more tags than asked, and two rows alike.
    expect([
      await none("Delete", row("Untitled query", "bitcoin")),
      await none("bitcoin", row("bitcoin", "bitcoin min_faves:100")),
      await none("$GOOGL OR $AAPL", row("Untitled query", "$GOOGL", "$AAPL", "$TSLA")),
      await none("eth", row("Untitled query", "eth"), row("Untitled query", "eth")),
      await none("$AAPL OR $AAPL", row("Untitled query", "$AAPL", "$TSLA")),
      pressed,
    ]).toEqual([false, false, false, false, false, []]);

    list(
      row("Untitled query", "$GOOGL", "$AAPL", "$TSLA"),
      row("Untitled query", "$AAPL", "$GOOGL"),
    );
    const done = xRadarDelete({ title: "", query: "$GOOGL OR $AAPL" }, show);
    await vi.advanceTimersByTimeAsync(2_000);
    expect([pressed, over]).toEqual([[1], [true]]);
    // The user answers X's dialog in X.
    document.querySelector('[role="dialog"]')!.remove();
    await vi.runAllTimersAsync();
    expect([await done, over]).toEqual([true, [true, false]]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("reads X's audience card on /compose/post, then brings back X's page, unless X was moved meanwhile", async () => {
  // X draws the card only on its compose page; Compose leaves the engine on the user's profile.
  const run = async (meanwhile?: string, inPage?: string) => {
    let path = "/theo";
    const steps: Array<string> = [];
    registerXWebview({
      loadURL: async () => {},
      getURL: () => `https://x.com${path}`,
      executeJavaScript: (code: string) => {
        const to = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
        if (to !== undefined) path = to;
        steps.push(to ?? (code.includes("Choose audience") ? "card" : "?"));
        // Another screen moves X while X's card is open, or X's own page does (a link, Back).
        if (to === undefined && meanwhile !== undefined) void xGo(`https://x.com${meanwhile}`);
        if (to === undefined && inPage !== undefined) path = inPage;
        return Promise.resolve(true);
      },
    } as unknown as XWebview);
    markXReady();
    await xAudienceCard();
    await xGifIdle();
    return steps;
  };
  expect(await run()).toEqual(["/compose/post", "card", "/theo"]);
  expect(await run("/explore")).toEqual(["/compose/post", "card", "/explore"]);
  expect(await run(undefined, "/jack")).toEqual(["/compose/post", "card"]);
});

it("never shows X's Edit profile over the main area once the user moved on while X opened it", async () => {
  document.body.innerHTML = `<button data-testid="editProfileButton"></button>`;
  // X opens its dialog's route, and the user leaves the profile before Xtend hears back.
  document.querySelector("button")!.addEventListener("click", () => {
    history.replaceState(null, "", "/settings/profile");
    xOverEnded();
  });
  inThisPage(() => `https://x.com${location.pathname}`);
  const start = location.href;
  try {
    history.replaceState(null, "", "/ann");
    const shown: Array<boolean> = [];
    expect(await xEditProfile("ann", (on) => shown.push(on))).toBeNull();
    expect(shown).toEqual([]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("leaves the overlay to a newer press when the user moves on while Xtend checks X's Edit profile", async () => {
  document.body.innerHTML = `<button data-testid="editProfileButton"></button>`;
  document
    .querySelector("button")!
    .addEventListener("click", () => history.replaceState(null, "", "/settings/profile"));
  // X closes its dialog, and the user opens another screen while Xtend's read of it is under way.
  let moveOn = false;
  const el = {
    loadURL: async () => {},
    getURL: () => `https://x.com${location.pathname}`,
    executeJavaScript: (code: string) => {
      const answer = new Function(`return ${code}`)();
      if (moveOn && code.startsWith('(location.pathname === "/settings/profile"')) {
        moveOn = false;
        xOverEnded();
      }
      return Promise.resolve(answer);
    },
  } satisfies Pick<XWebview, "loadURL" | "executeJavaScript" | "getURL">;
  registerXWebview(el as unknown as XWebview);
  markXReady();
  const start = location.href;
  try {
    history.replaceState(null, "", "/ann");
    const shown: Array<boolean> = [];
    const result = await xEditProfile("ann", (on) => {
      shown.push(on);
      if (on) {
        history.replaceState(null, "", "/ann");
        moveOn = true;
      }
    });
    expect(result).toBeNull();
    expect(shown).toEqual([true]);
  } finally {
    history.replaceState(null, "", start);
  }
});

it("finds X's own control by its words or its label, a checkbox row's box, and never one X draws twice", () => {
  document.body.innerHTML = `
    <a href="/i/communities/create" role="link"><svg aria-label="Create a new Community"></svg></a>
    <div role="button"><span>Leave moderation team</span></div>
    <label><div>Adult Content (NSFW)</div><input type="checkbox"></label><div>Help text</div>
    <div role="listitem"><div>Invite members</div><svg aria-label="Uncompleted"></svg></div>
    <a href="/i/communities/20/tools/members">Members<span>1,284 members</span></a>
    <button>Save</button><button>Save</button>`;
  expect(xControl(document, "Create a new Community")?.tagName).toBe("A");
  expect(xControl(document, "Leave moderation team")?.getAttribute("role")).toBe("button");
  expect((xControl(document, "Adult Content (NSFW)") as HTMLInputElement).type).toBe("checkbox");
  expect(xControl(document, "Invite members")?.getAttribute("role")).toBe("listitem");
  // A row whose words run on, and a name X draws twice, are never pressed.
  expect(xControl(document, "Members")).toBeNull();
  expect(xControl(document, "Save")).toBeNull();

  // In a queue, each row has its own: the one in the row that links to that post or person.
  document.body.innerHTML = `
    <div id="a"><article><a href="/ann/status/50"><time></time></a></article><button>Keep</button></div>
    <div id="b"><article><a href="/bo/status/51"><time></time></a><a href="/ann/status/50">quoted</a></article><button>Keep</button></div>`;
  // A post is its row's by its own timestamp link; one quoting it links to it with none.
  const own = (id: string) => `a[href$="/status/${id}"] time`;
  expect(xControl(document, "Keep", own("51"))?.parentElement?.id).toBe("b");
  expect(xControl(document, "Keep", own("50"))?.parentElement?.id).toBe("a");
  // Linked from both rows, a post names no one row: nothing is pressed.
  expect(xControl(document, "Keep", 'a[href$="/status/50"]')).toBeNull();
  expect(xControl(document, "Keep", own("52"))).toBeNull();
});

it("reads X's checklist card: its rows in X's order, each done or not, and none without the card", () => {
  document.body.innerHTML = `<div><div><h2>Community checklist</h2><button aria-label="Dismiss Checklist"></button></div>
    <div role="list"><div role="listitem"><div>Review your rules</div><svg aria-label="Completed"></svg></div>
    <div role="listitem"><div>Invite members</div><svg aria-label="Uncompleted"></svg></div></div></div>`;
  expect(xChecklist(document)).toEqual([
    { title: "Review your rules", done: true },
    { title: "Invite members", done: false },
  ]);
  document.body.innerHTML = `<div role="list"><div role="listitem">Something else</div></div>`;
  expect(xChecklist(document)).toBeNull();
});

it("holds X's page over the main area after the user confirms in X's sheet, until X leaves it", async () => {
  using _clock = fakeTimers();
  const start = location.pathname + location.search;
  history.replaceState(null, "", "/i/communities/20/tools");
  document.body.innerHTML = `<a href="/i/communities/20/tools/members">Members</a><div role="button"><span>Leave moderation team</span></div>`;
  // X's sheet on the press; its buttons close it, and after a confirm X writes before it moves on.
  document.querySelector('[role="button"]')!.addEventListener("click", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="alertdialog"><button data-testid="confirmationSheetConfirm">Yes, I want to leave</button><button data-testid="confirmationSheetCancel">Cancel</button></div>`,
    );
    for (const b of document.querySelectorAll('[role="alertdialog"] button'))
      b.addEventListener("click", () => document.querySelector('[role="alertdialog"]')!.remove());
  });
  inThisPage(() => `https://x.com${location.pathname}`);
  const shown: Array<boolean> = [];
  const drawn = (href: string) => /^\/i\/communities\/20(\/tools)?$/.test(new URL(href).pathname);
  const leave = () =>
    xPressToPage("/i/communities/20/tools", "Leave moderation team", drawn, (on) => shown.push(on));
  const sheet = (button: string) =>
    document.querySelector<HTMLElement>(`[data-testid="confirmationSheet${button}"]`)!.click();
  try {
    const leaving = leave();
    await vi.advanceTimersByTimeAsync(600);
    expect(shown).toEqual([true]);
    sheet("Confirm");
    // X is writing: back on its tools page with no sheet, it is not done yet.
    await vi.advanceTimersByTimeAsync(2000);
    expect(shown).toEqual([true]);
    history.replaceState(null, "", "/i/communities/20");
    await vi.advanceTimersByTimeAsync(600);
    expect([new URL(String(await leaving)).pathname, shown]).toEqual([
      "/i/communities/20",
      [true, false],
    ]);
    // Cancelled in X's sheet: X stays where it was, and is done.
    history.replaceState(null, "", "/i/communities/20/tools");
    const kept = leave();
    await vi.advanceTimersByTimeAsync(600);
    sheet("Cancel");
    await vi.advanceTimersByTimeAsync(600);
    expect(new URL(String(await kept)).pathname).toBe("/i/communities/20/tools");
  } finally {
    history.replaceState(null, "", start);
    registerXWebview(null);
  }
});

it("presses only the control in the box of the Community it is for, never one left from another", async () => {
  using _clock = fakeTimers();
  const start = location.pathname + location.search;
  const tools = (id: string) =>
    `<div data-c="${id}"><a href="/i/communities/${id}/tools/members">Members</a><div role="button"><span>Leave moderation team</span></div></div>`;
  const pressedIn: Array<string> = [];
  const listen = () => {
    for (const b of document.querySelectorAll('[role="button"]'))
      b.addEventListener("click", () =>
        pressedIn.push(b.closest<HTMLElement>("[data-c]")!.dataset.c!),
      );
  };
  inThisPage(() => `https://x.com${location.pathname}`);
  const leave = () =>
    xPressToPage(
      "/i/communities/20/tools",
      "Leave moderation team",
      () => true,
      () => {},
    );
  try {
    // X's router is on Community 20 already, while its page still draws Community 10's tools.
    history.replaceState(null, "", "/i/communities/20/tools");
    document.body.innerHTML = tools("10");
    listen();
    const refused = leave();
    await vi.advanceTimersByTimeAsync(8000);
    expect([await refused, pressedIn]).toEqual([false, []]);
    // Both drawn, the old one first: only Community 20's is pressed.
    document.body.innerHTML = tools("10") + tools("20");
    listen();
    const left = leave();
    await vi.advanceTimersByTimeAsync(8000);
    await left;
    expect(pressedIn).toEqual(["20"]);
  } finally {
    history.replaceState(null, "", start);
    registerXWebview(null);
  }
});

it("waits for X to turn a queue row after Keep, however long X's answer takes", async () => {
  using _clock = fakeTimers();
  const start = location.pathname + location.search;
  history.replaceState(null, "", "/i/communities/20/moderation/reported_tweets");
  document.body.innerHTML = `<div id="row"><article><a href="/ann/status/50"><time></time></a></article><button>Keep</button></div>`;
  // X answers its keep a while later, then draws "You kept this post" in the row's place.
  document.querySelector("button")!.addEventListener("click", () =>
    setTimeout(() => {
      document.querySelector("#row")!.outerHTML = `<div aria-label="You kept this post"></div>`;
    }, 1500),
  );
  inThisPage(() => `https://x.com${location.pathname}`);
  try {
    const keeping = xPressRow(
      "/i/communities/20/moderation/reported_tweets",
      'a[href$="/status/50"] time',
      "Keep",
      () => true,
      () => {},
    );
    await vi.advanceTimersByTimeAsync(4000);
    expect(await keeping).toMatchObject({ gone: true });
  } finally {
    history.replaceState(null, "", start);
    registerXWebview(null);
  }
});

it("ends a queue press whose read X's page never answers, once X loads anew or the user moves on", async () => {
  using _clock = fakeTimers();
  const start = location.pathname + location.search;
  history.replaceState(null, "", "/i/communities/20/moderation/reported_tweets");
  document.body.innerHTML = `<div><article><a href="/ann/status/50"><time></time></a></article><button>Keep</button></div>`;
  // X's page goes away under the press's last read: that read never answers.
  registerXWebview({
    loadURL: async () => {},
    getURL: () => `https://x.com${location.pathname}`,
    executeJavaScript: (code: string) =>
      code.includes("return find() === null;")
        ? new Promise(() => {})
        : Promise.resolve(new Function(`return ${code}`)()),
  } as unknown as XWebview);
  markXReady();
  const keep = () => {
    let ended = false;
    void xPressRow(
      "/i/communities/20/moderation/reported_tweets",
      'a[href$="/status/50"] time',
      "Keep",
      () => true,
      () => {},
    ).then(() => (ended = true));
    return () => ended;
  };
  try {
    const reloaded = keep();
    await vi.advanceTimersByTimeAsync(2000);
    expect(reloaded()).toBe(false);
    // X's page loads anew.
    markXReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded()).toBe(true);
    // The user opens another screen while it reads.
    const left = keep();
    await vi.advanceTimersByTimeAsync(2000);
    xOverEnded();
    await vi.advanceTimersByTimeAsync(0);
    expect(left()).toBe(true);
  } finally {
    history.replaceState(null, "", start);
    registerXWebview(null);
  }
});

it("ends a scroll for X's next page that X's page never answers, once X loads anew or the list goes", async () => {
  // X's page goes away under the scroll: its read never answers.
  registerXWebview({
    loadURL: async () => {},
    getURL: () => "https://x.com/i/communities/20/moderation/reported_tweets",
    executeJavaScript: () => new Promise(() => {}),
  } as unknown as XWebview);
  markXReady();
  const scroll = (signal?: AbortSignal) => {
    let ended = false;
    void xScrollMore(signal).then(() => (ended = true));
    return () => ended;
  };
  try {
    const reloaded = scroll();
    await Promise.resolve();
    expect(reloaded()).toBe(false);
    markXReady();
    await expect.poll(reloaded).toBe(true);
    const gone = new AbortController();
    const left = scroll(gone.signal);
    gone.abort();
    await expect.poll(left).toBe(true);
  } finally {
    registerXWebview(null);
  }
});
