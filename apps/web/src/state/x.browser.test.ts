import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../test/render";

import {
  communityButton,
  markXReady,
  xAct,
  registerXWebview,
  xCommunityJoin,
  xCommunityPin,
  xActInPlace,
  xFollow,
  xPostMenu,
  xOverEnded,
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
