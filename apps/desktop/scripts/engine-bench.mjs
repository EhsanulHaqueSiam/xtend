// Benchmarks for the X engine under Xtend's own X screens, against a running dev desktop started
// with XTEND_REMOTE_DEBUG (see docs/internals/native-shell.md). Each check drives the app page or
// moves the engine the way a screen does, waits for what X's session sends, and asserts on the
// engine store (window.__xtendEngine, dev builds only) and on the native screen where one exists.
// Writes stay dry: X's buttons for posting, replying, reposting, liking and following are only
// found, never pressed. The one write is a bookmark, which is private, and it is undone.
//   node scripts/engine-bench.mjs                 every check once
//   node scripts/engine-bench.mjs --runs 3        until three passes in a row, at most 3 rounds
//   node scripts/engine-bench.mjs --pause 300     seconds between runs: X rate-limits an account
//                                                 per 15 minutes, and a run is a few hundred calls
//   node scripts/engine-bench.mjs --only video    checks whose name contains "video"
//   node scripts/engine-bench.mjs --shots DIR     a screenshot of the app after each check
//   node scripts/engine-bench.mjs --parity DIR    per screen, Xtend's screen and x.com on the same
//                                                 page: DIR/<screen>-xtend.png and DIR/<screen>-x.png
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.XTEND_REMOTE_DEBUG ?? "9223";
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const RUNS = Number(flag("--runs") ?? 1);
const PAUSE_MS = Number(flag("--pause") ?? 0) * 1000;
const ONLY = flag("--only");
const SHOTS = flag("--shots");
const PARITY = flag("--parity");

/** One DevTools session per page, kept open across checks. */
const sessions = new Map();
async function session(match) {
  const all = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = all.find(
    (t) => t.url.includes(match) && (t.type === "page" || t.type === "webview"),
  );
  if (target === undefined) throw new Error(`no target matching ${match}`);
  const open = sessions.get(match);
  if (open?.id === target.id && open.socket.readyState === WebSocket.OPEN) return open;
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const waiting = new Map();
  socket.addEventListener("message", (e) => {
    const message = JSON.parse(String(e.data));
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const own = ++id;
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000);
      waiting.set(own, (m) => (clearTimeout(timer), resolve(m)));
      socket.send(JSON.stringify({ id: own, method, params }));
    });
  const made = { id: target.id, socket, call };
  sessions.set(match, made);
  return made;
}

/** Evaluates `expression` in the page whose URL contains `match`, as a user gesture. */
async function evaluate(match, expression) {
  const { call } = await session(match);
  const { result } = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result?.result?.value;
}

const app = (expression) => evaluate("localhost", expression);
const engine = (expression) => evaluate("x.com", expression);
const go = (hash) => app(`location.hash = ${JSON.stringify(hash)}, true`);
/** The engine store, read in the app page: `$` is the state, `at(per, surface)` one surface. */
const store = (expression) =>
  app(
    `(() => { const $ = window.__xtendEngine?.(); if (!$) return undefined; const at = (per, s) => per[s] ?? []; return ${expression}; })()`,
  );
const TAB = { forYou: "For you", following: "Following" };
/**
 * Native Home on `feed`, with the engine on X's Home and that tab picked, as the Home screen
 * leaves it; when the app already showed that feed the screen has no reason to move the engine.
 */
async function home(feed) {
  await go(`#/home?feed=${feed}`);
  if ((await enginePath().catch(() => "")) !== "/home") {
    await engine(`location.href = "https://x.com/home", true`).catch(() => {});
    await sleep(1_000);
  }
  const selected = () =>
    engine(`document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim()`);
  await until(async () => {
    if ((await selected()) === TAB[feed]) return true;
    await engine(
      `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(TAB[feed])})?.click(), true`,
    );
    return false;
  }, 15_000);
  await engine(`window.scrollTo(0, 0), true`);
  // What X put on top of its page waits behind the pill; shown, the native top is X's page.
  await until(async () => {
    await app(
      `[...document.querySelectorAll("main button")].find((b) => /new post|Show \\d+ posts?/.test(b.textContent))?.click(), true`,
    );
    const ids = (await nativeIds()).slice(0, 5);
    return ids.length > 0 && engine(`${JSON.stringify(ids)}.some((id) => !!${xArticleOf("id")})`);
  }, 15_000);
}

/** Empties surfaces in the store, so a check sees only what X sends from now on. */
const reset = (...surfaces) =>
  app(`${JSON.stringify(surfaces)}.forEach((s) => window.__xtendEngineReset(s)), true`);
/**
 * Opens `path` in the engine through X's router and waits for `check`. X may already hold the
 * page (it prefetches some, like Notifications) and then fetches nothing, so after a while the
 * page reloads in full. Resolves to the check's value, noting a reload.
 */
async function visit(path, check) {
  await engineGo(path);
  const routed = await until(check, 8_000);
  if (routed) return routed;
  await engine(`location.reload(), true`).catch(() => {});
  const loaded = await until(check, 20_000);
  return loaded && `${loaded} (full load)`;
}

/** Moves the engine through X's router, as `xGo` does. */
const engineGo = (path) =>
  engine(
    `(history.pushState(null, "", ${JSON.stringify(path)}), dispatchEvent(new PopStateEvent("popstate", { state: null })), true)`,
  );
const enginePath = () => engine("location.pathname + location.search");
const nativeIds = () =>
  app(`[...document.querySelectorAll("main article[data-post]")].map((a) => a.dataset.post)`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `check` until it returns a truthy value or `ms` pass. */
async function until(check, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential by nature
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) return undefined;
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential by nature
    await sleep(400);
  }
}

/**
 * X's article in the engine page for the post id `idJs` evaluates to: the one whose timestamp links
 * to it, or to its edit history once edited.
 */
const xArticleOf = (idJs) =>
  `document.querySelector('article a[href$="/status/' + ${idJs} + '"] time, article a[href$="/status/' + ${idJs} + '/history"] time')?.closest("article")`;
const xArticle = (id) => xArticleOf(JSON.stringify(id));

/**
 * Posts the bench bookmarked, by id to handle. A bookmark is the one write the bench makes; after
 * every run each is checked against a fresh load of its page and removed if it is still there.
 */
const touched = new Map();
/** Every post the bench pressed X's button on: Xtend's copy of a post takes one press, so never twice. */
const pressedOnce = new Set();

/** X's own article for a post on its page: matched by its timestamp, or the focal one. */
const focalArticle = (id) =>
  `(${xArticle(id)} ?? document.querySelector('article[tabindex="-1"]'))`;

/**
 * Whether X says the post is bookmarked, read from X's own button after a full load of the post's
 * page (X's in-page cache can lag). Undefined when X's page did not show the post.
 */
async function bookmarkedOnX(id, handle) {
  await engine(`location.href = "https://x.com/${handle}/status/${id}", true`).catch(() => {});
  await sleep(1_000);
  const state = await until(
    () =>
      engine(
        `(() => { const a = ${focalArticle(id)}; if (!a) return undefined; return a.querySelector('[data-testid="removeBookmark"]') ? "on" : a.querySelector('[data-testid="bookmark"]') ? "off" : undefined; })()`,
      ),
    20_000,
  );
  return state === undefined ? undefined : state === "on";
}

/**
 * Removes the bench's bookmark through X's own button on the post's page if X still has it.
 * True only once a fresh load shows it gone.
 */
async function unbookmark(id, handle, known) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Each full load costs X's Viewer call, which X rate-limits; a state just read is reused.
    // oxlint-disable-next-line no-await-in-loop -- one page at a time, until X agrees
    const on = attempt === 0 && known !== undefined ? known : await bookmarkedOnX(id, handle);
    if (on === false) return true;
    if (on === true) {
      // oxlint-disable-next-line no-await-in-loop -- X's own button, where it sits
      await engine(
        `${focalArticle(id)}?.querySelector('[data-testid="removeBookmark"]')?.click(), true`,
      );
      // oxlint-disable-next-line no-await-in-loop -- X's mutation settles before the next look
      await sleep(2_000);
    }
  }
  return false;
}

/** The first native post X's own page also draws now, with X's button `testid` on it. */
const heldByEngine = (testid) =>
  until(async () => {
    // Never a post the user bookmarked themselves (the bench undoes only its own), nor an ad.
    const ids = await store(
      `${JSON.stringify((await nativeIds()).filter((id) => !pressedOnce.has(id)))}.filter((id) => $.posts.get(id)?.bookmarked === false && !$.posts.get(id).isPromoted)`,
    );
    return engine(
      `${JSON.stringify(ids.slice(0, 12))}.find((id) => !!${xArticleOf("id")}?.querySelector(${JSON.stringify(testid)}))`,
    );
  });

const SEARCH = "filter:native_video min_faves:500";
let theoId = "";

const benchmarks = [
  [
    "A cold start on Following gets X's posts while X last showed For you",
    async () => {
      // X remembers its last tab: leave it on For you, then start the app on Following.
      await engine(
        `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === "For you")?.click(), true`,
      ).catch(() => {});
      await sleep(1_500);
      await app(`(location.hash = "#/home?feed=following", location.reload(), true)`).catch(
        () => {},
      );
      await sleep(2_000);
      sessions.clear();
      // This reload is the check itself: the engine must not be reloaded after it.
      await until(() => app(`typeof window.__xtendEngine === "function"`), 20_000);
      await sameAppPage({ reloadEngine: false });
      return until(async () => {
        const [ids, list] = [await nativeIds(), await store(`$.lists.following`)];
        return ids.length >= 1 && list?.length >= 3 && list[0] === ids[0] && list.length;
      }, 30_000);
    },
  ],
  [
    "Home Following renders X's posts in X's order",
    async () => {
      // As at the app's start: the engine loads X's Home in full, so X sends its Home tabs too.
      await engine(`location.href = "https://x.com/home", true`).catch(() => {});
      await reset("following", "forYou");
      await until(async () => (await engine(`document.readyState`)) === "complete", 15_000);
      // Arriving from another screen, as a user does, so the Home screen picks X's tab itself.
      await go("#/settings");
      await go("#/home?feed=following");
      return until(async () => {
        const [ids, list] = [await nativeIds(), await store(`$.lists.following`)];
        // A tall post can fill the screen, so the screen may draw fewer posts than the store holds.
        return (
          ids.length >= 1 &&
          list?.length >= 3 &&
          list.slice(0, ids.length).join() === ids.join() &&
          list.length
        );
      });
    },
  ],
  [
    "Home For you renders X's posts in X's order",
    async () => {
      await go("#/home?feed=forYou");
      return until(async () => {
        const [ids, list] = [await nativeIds(), await store(`$.lists.forYou`)];
        return (
          ids.length >= 1 &&
          list?.length >= 3 &&
          list.slice(0, ids.length).join() === ids.join() &&
          list.length
        );
      });
    },
  ],
  [
    "Engine is on X's Home under native Home",
    () => until(async () => (await enginePath()) === "/home"),
  ],
  [
    "Home's pinned tabs are read from X, and one switches through the engine",
    async () => {
      const tabs = await until(() => store(`$.homeTabs.length > 0 && $.homeTabs`));
      if (!tabs) return false;
      // Every tab X read for the store is one X draws.
      const drawn = await until(async () => {
        const onX = await engine(
          `[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())`,
        );
        return tabs.every((t) => onX.includes(t.label));
      }, 10_000);
      if (!drawn) return false;
      await reset(tabs[0].id);
      const tab = tabs[0];
      await engine(
        `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(tab.label)})?.click(), true`,
      );
      const got = await until(() =>
        store(
          `at($.lists, ${JSON.stringify(tab.id)}).length >= 3 && at($.lists, ${JSON.stringify(tab.id)}).length`,
        ),
      );
      await engine(
        `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === "For you")?.click(), true`,
      );
      return got && `${tab.label}: ${got} posts`;
    },
  ],
  [
    "X's own like, repost, reply, share and bookmark exist for a native post (dry)",
    async () => (
      await home("forYou"),
      until(async () => {
        const id = await heldByEngine('[data-testid="like"],[data-testid="unlike"]');
        return (
          id &&
          engine(
            `(() => { const a = ${xArticle(id)}; return !!a && ["like|unlike", "retweet|unretweet", "reply", "bookmark|removeBookmark"].every((ids) => ids.split("|").some((t) => a.querySelector('[data-testid="' + t + '"]'))); })()`,
          )
        );
      })
    ),
  ],
  [
    "Feed loads more when the native list reaches its end",
    async () => {
      await home("forYou");
      // Counts the engine's scroll requests, to tell a list that never asked from an X that never answered.
      await engine(
        `window.__xtendScrolls ??= (() => { const scroll = window.scrollTo.bind(window); window.scrollTo = (...a) => (window.__xtendScrolls++, scroll(...a)); return 0; })(), true`,
      );
      const asked = await engine(`window.__xtendScrolls`);
      const before = await store(`$.lists.forYou.length`);
      const lastBefore = (await nativeIds()).at(-1);
      // Reaching the end of the virtualized list asks X's page for its next one.
      const grew = await until(async () => {
        await app(
          `(() => { const s = document.querySelector("main [data-virtuoso-scroller]"); if (s) s.scrollTop = s.scrollHeight; return true; })()`,
        );
        return (await store(`$.lists.forYou.length`)) > before + 3;
      }, 30_000);
      const lastAfter = await until(async () => {
        const last = (await nativeIds()).at(-1);
        return last !== lastBefore && last;
      }, 5_000);
      if (!grew)
        console.log(
          `      the list asked X to scroll ${(await engine(`window.__xtendScrolls`)) - asked} times`,
        );
      return grew && lastAfter && `${before} → ${await store(`$.lists.forYou.length`)} posts`;
    },
  ],
  [
    "Newer posts wait behind the pill; the list never jumps",
    async () => {
      await app(
        `(() => { const s = document.querySelector("main [data-virtuoso-scroller]"); if (s) s.scrollTop = 0; return true; })()`,
      );
      const top = (await store(`$.lists.forYou`))?.[0];
      // X reloading its first page is what its "Show N posts" fetch is to an open list.
      await engine(`location.reload(), true`);
      await until(async () => (await engine(`document.querySelectorAll("article").length`)) >= 3);
      await sleep(3_000);
      const [after, waiting] = [
        await store(`$.lists.forYou[0]`),
        await store(`$.waiting.forYou.length`),
      ];
      const pill =
        waiting > 0
          ? await until(
              () =>
                app(
                  `[...document.querySelectorAll("main button")].some((b) => /new post|Show \\d+ posts?/.test(b.textContent))`,
                ),
              5_000,
            )
          : true;
      return top !== undefined && after === top && pill && `${waiting} waiting`;
    },
  ],
  [
    "A bookmark presses X's own button in place, and is undone",
    async () => {
      await home("forYou");
      const id = await heldByEngine('[data-testid="bookmark"]');
      if (!id) return false;
      touched.set(id, await store(`$.posts.get(${JSON.stringify(id)}).author.handle`));
      pressedOnce.add(id);
      await app(
        `document.querySelector('[data-post="${id}"] button[aria-label="Bookmark on X"]')?.click(), true`,
      );
      const pressed = await until(
        () => engine(`!!${xArticle(id)}?.querySelector('[data-testid="removeBookmark"]')`),
        10_000,
      );
      const stayed = (await enginePath()) === "/home";
      // Undo through X's own button, where it sits, once X has saved the bookmark.
      await sleep(2_000);
      await engine(
        `${xArticle(id)}?.querySelector('[data-testid="removeBookmark"]')?.click(), true`,
      );
      const undoneHere = await until(
        () => engine(`!!${xArticle(id)}?.querySelector('[data-testid="bookmark"]')`),
        10_000,
      );
      await sleep(2_000);
      // X's word on a fresh load, not its page's: the account is as it was.
      const undone = undoneHere && (await unbookmark(id, touched.get(id)));
      if (undone) touched.delete(id);
      if (!(pressed && stayed && undone))
        console.log(`      ${JSON.stringify({ id, pressed, stayed, undoneHere, undone })}`);
      await home("forYou");
      return pressed && stayed && undone;
    },
  ],
  [
    "An action on a post the engine page no longer holds falls back and returns to the list",
    async () => {
      await home("forYou");
      // The engine scrolls far down until X has unmounted the list's first post.
      const id = await until(async () => {
        await engine(`window.scrollTo(0, document.documentElement.scrollHeight), true`);
        await sleep(1_000);
        const first = await store(
          `$.lists.forYou.find((id) => !${JSON.stringify([...pressedOnce])}.includes(id) && $.posts.get(id)?.bookmarked === false && !$.posts.get(id).isPromoted)`,
        );
        return first && !(await engine(`!!${xArticle(first)}`)) && first;
      }, 30_000);
      if (!id) return false;
      const handle = await store(`$.posts.get(${JSON.stringify(id)}).author.handle`);
      // The native list's top, where that post is drawn.
      await app(
        `(() => { const s = document.querySelector("main [data-virtuoso-scroller]"); if (s) s.scrollTop = 0; return true; })()`,
      );
      if (
        !(await until(
          () =>
            app(
              `!!document.querySelector('[data-post="${id}"] button[aria-label="Bookmark on X"]')`,
            ),
          5_000,
        ))
      )
        return false;
      touched.set(id, handle);
      pressedOnce.add(id);
      // Every page the engine passes through, sampled, to tell the fallback from a press in place.
      const paths = [];
      let sampling = true;
      const sampler = (async () => {
        // oxlint-disable-next-line no-unmodified-loop-condition -- the check clears it when done
        while (sampling) {
          // oxlint-disable-next-line no-await-in-loop -- a sampler
          const path = await enginePath().catch(() => "(loading)");
          if (paths.at(-1) !== path) paths.push(path);
          // oxlint-disable-next-line no-await-in-loop -- a sampler
          await sleep(200);
        }
      })();
      await app(
        `document.querySelector('[data-post="${id}"] button[aria-label="Bookmark on X"]')?.click(), true`,
      );
      // The engine goes to the post's page (it presses there as soon as X draws the post, often
      // before X's thread arrives), then comes back to the list.
      const visited = await until(
        async () => paths.some((p) => p.endsWith(`/status/${id}`)),
        25_000,
      );
      const back = visited && (await until(async () => paths.at(-1) === "/home", 25_000));
      sampling = false;
      await sampler;
      await sleep(2_000);
      const state = await bookmarkedOnX(id, handle);
      const pressed = state === true;
      const undone = await unbookmark(id, handle, state);
      if (undone) touched.delete(id);
      await go("#/home?feed=following");
      if (!(back && pressed && undone))
        console.log(`      ${JSON.stringify({ id, visited, back, pressed, undone, paths })}`);
      return back && pressed && undone;
    },
  ],
  [
    "Search Top renders what X sends for the query now",
    async () => {
      // Emptied first, so only this search's fresh results can fill them.
      await reset(`search:Top:${SEARCH}`, "search");
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
      return until(async () => {
        const ids = await nativeIds();
        const [shown, keyed] = [
          await store(`$.lists.search`),
          await store(`at($.lists, ${JSON.stringify(`search:Top:${SEARCH}`)})`),
        ];
        return (
          ids.length >= 1 &&
          shown?.length >= 2 &&
          shown[0] === ids[0] &&
          keyed?.includes(ids[0]) &&
          shown.length
        );
      });
    },
  ],
  [
    "A video plays from X's mp4 and goes fullscreen",
    async () => {
      const video = `document.querySelector("main article video")`;
      const ready = await until(() =>
        app(`!!${video} && ${video}.readyState >= 1 && /\\.mp4/.test(${video}.currentSrc)`),
      );
      if (!ready) return false;
      await app(`(${video}.muted = true, ${video}.play().then(() => true, () => false))`);
      const start = await app(`${video}.currentTime`);
      const played = await until(
        async () => (await app(`${video}.currentTime`)) > start + 0.5,
        10_000,
      );
      const full = await app(
        `${video}.requestFullscreen().then(() => document.fullscreenElement === ${video}, () => false)`,
      );
      await app(
        `(${video}.pause(), document.fullscreenElement ? document.exitFullscreen().then(() => true) : true)`,
      );
      return played && full && `error ${await app(`${video}.error?.code ?? "none"`)}`;
    },
  ],
  [
    "Search Latest, People and Media read X's own tabs",
    async () => {
      const q = "react";
      await reset(...["Latest", "People", "Media"].map((p) => `search:${p}:${q}`));
      const counts = [];
      for (const [f, product, per] of [
        ["live", "Latest", "lists"],
        ["user", "People", "people"],
        ["media", "Media", "lists"],
      ]) {
        const surface = JSON.stringify(`search:${product}:${q}`);
        // oxlint-disable-next-line no-await-in-loop -- one engine, one page at a time
        const n = await visit(`/search?q=${q}&src=typed_query&f=${f}`, () =>
          store(`at($.${per}, ${surface}).length >= 3 && at($.${per}, ${surface}).length`),
        );
        if (!n) return false;
        counts.push(`${product} ${n}`);
      }
      return counts.join(", ");
    },
  ],
  [
    "Link cards, Community Notes, reply context and social context reach the store",
    () =>
      until(() =>
        store(
          `(() => { const ps = [...$.posts.values()]; const n = { cards: ps.filter((p) => p.card).length, replies: ps.filter((p) => p.replyingTo.length).length, context: ps.filter((p) => p.context).length, followers: ps.filter((p) => p.author.followers !== null).length }; return n.cards > 0 && n.replies > 0 && n.context > 0 && n.followers > 0 && JSON.stringify(n); })()`,
        ),
      ),
  ],
  [
    "Post opens with its thread and the reply composer",
    async () => {
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
      const id = await until(async () => (await nativeIds())[0]);
      await app(`document.querySelector("main article p")?.click(), true`);
      return until(
        async () =>
          (await app(
            `!!document.querySelector('textarea[aria-label="Your reply"]') && document.querySelectorAll("main article").length >= 1`,
          )) &&
          (await enginePath()).includes(`/status/${id}`) &&
          (await store(`at($.lists, "post:${id}").length > 0`)),
      );
    },
  ],
  [
    "X's reply, repost, quote and like are reachable on the post (dry)",
    async () => {
      const post = await until(() =>
        store(
          `(() => { const p = $.posts.get($.lists.forYou.find((id) => !$.posts.get(id).isPromoted)); return p && { id: p.postId, handle: p.author.handle }; })()`,
        ),
      );
      if (!post) return false;
      await engineGo(`/${post.handle}/status/${post.id}`);
      return until(() =>
        engine(
          `(() => { const a = ${xArticle(post.id)}; return !!a && ["reply", "retweet|unretweet", "like|unlike"].every((ids) => ids.split("|").some((t) => a.querySelector('[data-testid="' + t + '"]'))); })()`,
        ),
      );
    },
  ],
  [
    "Bookmarks render",
    async () => {
      await reset("bookmarks");
      await go("#/bookmarks");
      return until(async () => {
        const [ids, list] = [await nativeIds(), await store(`$.lists.bookmarks`)];
        return ids.length >= 1 && list?.[0] === ids[0] && ids.length;
      });
    },
  ],
  [
    "A profile renders its posts and X's header",
    async () => {
      await go("#/u/theo");
      const user = await until(() =>
        store(
          `(() => { const u = [...$.users.values()].find((u) => u.handle === "theo"); return u && u.followers > 0 && u.bio !== "" && u; })()`,
        ),
      );
      if (!user) return false;
      theoId = user.userId;
      const posts = await until(
        async () =>
          (await nativeIds()).length >= 2 &&
          (await store(`at($.lists, "profile:posts:${theoId}").length`)),
      );
      return posts && `${user.followers} followers, ${posts} posts`;
    },
  ],
  [
    "A profile's Replies and Media tabs read X's own tabs",
    async () => {
      await reset(`profile:replies:${theoId}`, `profile:media:${theoId}`);
      const counts = [];
      for (const [path, tab] of [
        ["with_replies", "replies"],
        ["media", "media"],
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- one engine, one page at a time
        const n = await visit(`/theo/${path}`, () =>
          store(
            `at($.lists, "profile:${tab}:${theoId}").length >= 2 && at($.lists, "profile:${tab}:${theoId}").length`,
          ),
        );
        if (!n) return false;
        counts.push(`${tab} ${n}`);
      }
      return counts.join(", ");
    },
  ],
  [
    "X's follow button is reachable on a profile (dry)",
    async () => (
      await engineGo("/theo"),
      until(() =>
        engine(`!!document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]')`),
      )
    ),
  ],
  [
    "Notifications and Mentions read X's notifications",
    async () => {
      await reset("notifications", "notifications:mentions");
      const all = await visit("/notifications", () =>
        store(`$.notifications.notifications.length >= 3 && $.notifications.notifications.length`),
      );
      const mentions = await visit("/notifications/mentions", () =>
        store(
          `$.notifications["notifications:mentions"].length >= 1 && $.notifications["notifications:mentions"].length`,
        ),
      );
      const posts = await store(
        `$.notifications.notifications.flatMap((n) => n.postIds).every((id) => $.posts.has(id))`,
      );
      return all && mentions && posts && `${all} all, ${mentions} mentions`;
    },
  ],
  [
    "Explore reads its tabs and trends, and the Trending tab",
    async () => {
      await reset(...(await store(`$.exploreTabs.map((t) => "explore:" + t.timelineId)`)));
      const forYou = await visit("/explore", () =>
        store(
          `$.exploreTabs.length >= 3 && at($.trends, "explore:" + $.exploreTabs[0].timelineId).length >= 3 && at($.trends, "explore:" + $.exploreTabs[0].timelineId).length`,
        ),
      );
      const tabs = await store(`$.exploreTabs`);
      const trending = tabs.find((t) => t.id === "trending");
      if (!forYou || !trending) return false;
      const n = await visit("/explore/tabs/trending", () =>
        store(
          `at($.trends, "explore:${trending.timelineId}").length >= 5 && at($.trends, "explore:${trending.timelineId}").length`,
        ),
      );
      return forYou && n && `${tabs.length} tabs, ${forYou} + ${n} trends`;
    },
  ],
  [
    "Lists reads X's Lists page and a List's posts",
    async () => {
      const viewer = await until(
        () =>
          engine(
            `document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href")?.slice(1)`,
          ),
        10_000,
      );
      if (!viewer) return false;
      await reset("lists");
      if (!(await visit(`/${viewer}/lists`, () => store(`$.listIds.lists.length > 0`))))
        return false;
      const id = await store(`$.listIds.lists[0]`);
      await reset(`list:${id}`);
      const n = await visit(`/i/lists/${id}`, () =>
        store(`at($.lists, "list:${id}").length >= 3 && at($.lists, "list:${id}").length`),
      );
      return n && `${await store(`$.listIds.lists.length`)} lists, ${n} posts`;
    },
  ],
  [
    "X's composer and Post button are reachable on the engine (dry)",
    async () => {
      await engineGo("/compose/post");
      const ok = await until(() =>
        engine(
          `!!document.querySelector('[data-testid="tweetTextarea_0"]') && !!document.querySelector('[data-testid="tweetButton"]')`,
        ),
      );
      // Leave without typing: X's composer closes on Back.
      await engine(`history.back(), true`);
      await until(async () => !(await enginePath()).startsWith("/compose"), 5_000);
      return ok;
    },
  ],
  [
    "⌘R reloads Home and a post from X: lists refill in X's order, the post stays",
    async () => {
      // `__xtendRefresh` is what main's ⌘R and F5 call: DevTools keys skip before-input-event.
      const refresh = (surface) =>
        app(
          `(window.__xtendRefresh(), window.__xtendEngine().lists[${JSON.stringify(surface)}]?.length ?? 0)`,
        );
      const loadedSince = async (origin) => (await engine(`performance.timeOrigin`)) !== origin;
      await home("following");
      let origin = await engine(`performance.timeOrigin`);
      if ((await refresh("following")) !== 0) return false;
      // X's first dated article (an ad has no timestamp link), against the store's first non-ad.
      const xFirst = `(() => { for (const a of document.querySelectorAll("article")) { const href = a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href"); if (href) return href.split("/status/")[1].split("/")[0]; } })()`;
      const homeOk = await until(async () => {
        if (!(await loadedSince(origin))) return false;
        const [ids, list] = [await nativeIds(), await store(`$.lists.following`)];
        const first = await store(`$.lists.following.find((id) => !$.posts.get(id).isPromoted)`);
        return (
          list?.length >= 3 && ids[0] === list[0] && first === (await engine(xFirst)) && list.length
        );
      }, 30_000);
      if (!homeOk) return false;
      const post = await store(
        `(() => { const p = $.posts.get($.lists.following.find((id) => !$.posts.get(id).isPromoted && $.posts.get(id).metrics.replies > 0)); return p && { id: p.postId, handle: p.author.handle }; })()`,
      );
      if (!post) return false;
      const surface = `post:${post.id}`;
      await go(`#/post/${post.id}?h=${post.handle}`);
      if (!(await until(() => store(`at($.lists, ${JSON.stringify(surface)}).length > 0`))))
        return false;
      await sleep(2_100); // past refreshScreen's floor
      origin = await engine(`performance.timeOrigin`);
      if ((await refresh(surface)) !== 0) return false;
      // The post and its reply box stay drawn while its replies load again.
      let kept = true;
      const postOk = await until(async () => {
        kept &&= (await nativeIds()).includes(post.id);
        return (
          (await loadedSince(origin)) &&
          (await store(`at($.lists, ${JSON.stringify(surface)}).length`))
        );
      }, 30_000);
      return kept && postOk && `Home ${homeOk} posts, post ${postOk} in its thread`;
    },
  ],
  [
    "Messages stays x.com itself, over the main area",
    async () => {
      await app(
        `[...document.querySelectorAll("nav button, aside button")].find((b) => b.textContent.trim() === "Messages" || b.getAttribute("aria-label") === "Messages")?.click(), true`,
      );
      return until(
        async () =>
          (await app(
            `location.hash.startsWith("#/x") && document.querySelector('section[aria-label="x.com"]')?.dataset.mode === "main"`,
          )) && /^\/(messages|i\/chat)/.test(await enginePath()),
      );
    },
  ],
  [
    "Back on Home, the engine follows",
    async () => (
      await go("#/home?feed=following"),
      until(async () => (await enginePath()) === "/home" && (await nativeIds()).length >= 1, 20_000)
    ),
  ],
];

const chosen = benchmarks.filter(
  ([name]) => ONLY === undefined || name.toLowerCase().includes(ONLY.toLowerCase()),
);
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });

/**
 * In dev, Vite may reload the app page on its own while the engine keeps its page: the store
 * starts empty and X has no reason to fetch again. In the packaged app the two load together, so
 * when the app page reloaded, the engine reloads too, as at the app's start.
 */
async function sameAppPage({ reloadEngine = true } = {}) {
  if (await app(`window.__xtendBench === true`)) return;
  // Counts what reaches the app page, to tell a capture that stopped from a store that did.
  await app(
    `(window.__xtendBench = true, window.__xtendBatches = 0, window.desktopBridge.onEngine(() => window.__xtendBatches++), true)`,
  );
  if (primed && reloadEngine) {
    console.log("  (the app page reloaded; reloading the engine with it)");
    await engine(`location.reload(), true`).catch(() => {});
    await until(async () => (await engine(`document.readyState`)) === "complete", 15_000);
  }
}
let primed = false;

/** One pass over the chosen checks; the names that failed. */
async function round(n) {
  const failed = [];
  for (const [index, [name, run]] of chosen.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- before each check
    await sameAppPage();
    primed = true;
    const started = Date.now();
    // Every page the engine passes through during the check, for the failure note.
    const trail = [];
    let tracing = true;
    const tracer = (async () => {
      // oxlint-disable-next-line no-unmodified-loop-condition -- the round clears it when done
      while (tracing) {
        // oxlint-disable-next-line no-await-in-loop -- a sampler
        const path = await enginePath().catch(() => "(loading)");
        if (trail.at(-1) !== path) trail.push(path);
        // oxlint-disable-next-line no-await-in-loop -- a sampler
        await sleep(250);
      }
    })();
    const value =
      WRITES.test(name) && !writes
        ? false
        : // oxlint-disable-next-line no-await-in-loop -- one engine, one check at a time
          await run().catch((error) => (console.error(`  ${name}: ${error.message}`), false));
    tracing = false;
    // oxlint-disable-next-line no-await-in-loop -- the sampler stops with the check
    await tracer;
    const ok = Boolean(value);
    if (!ok) {
      failed.push(name);
      // Where things stood, to tell a slow X from a broken step.
      // oxlint-disable-next-line no-await-in-loop -- only on a failure
      const where = await Promise.all([
        app(`location.hash + " batches " + window.__xtendBatches`),
        enginePath(),
        nativeIds().then((ids) => ids.slice(0, 3)),
        store(
          `Object.entries($.lists).filter(([k, l]) => l.length > 0 && !k.startsWith("post:")).map(([k, l]) => k + "=" + l.length + ":" + l[0]).join(" ").slice(0, 400)`,
        ),
      ]).catch((error) => [error.message]);
      // oxlint-disable-next-line no-await-in-loop -- only on a failure
      const timers = await Promise.race([
        engine(
          `new Promise((r) => { const t = performance.now(); setTimeout(() => r(document.visibilityState + ", a 100ms timer took " + Math.round(performance.now() - t) + "ms, page up " + Math.round(performance.now() / 1000) + "s"), 100); })`,
        ),
        sleep(5_000).then(() => "a 100ms timer took over 5s"),
      ]).catch(() => "?");
      console.log(
        `      ${JSON.stringify(where)}\n      engine went: ${trail.join(" → ").slice(0, 600)}\n      X's page: ${timers}`,
      );
    }
    const detail = typeof value === "string" || typeof value === "number" ? `  (${value})` : "";
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${String(Date.now() - started).padStart(6)}ms  ${name}${detail}`,
    );
    if (SHOTS !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- the app page as the check left it
      const { call } = await session("localhost");
      // oxlint-disable-next-line no-await-in-loop -- the app page as the check left it
      const shot = await call("Page.captureScreenshot", { format: "png" });
      writeFileSync(
        `${SHOTS}/run${n}-${String(index + 1).padStart(2, "0")}.png`,
        Buffer.from(shot.result.data, "base64"),
      );
    }
  }
  const cleaned = touched.size > 0;
  for (const [id, handle] of touched) {
    // oxlint-disable-next-line no-await-in-loop -- one engine, one page at a time
    if (!(await unbookmark(id, handle)))
      console.log(`  WARNING: could not remove the bench's bookmark on ${handle}/${id}`);
  }
  touched.clear();
  if (cleaned) await go("#/home?feed=following");
  console.log(`${chosen.length - failed.length}/${chosen.length} passed`);
  return failed;
}

/**
 * Starts as the app does: the app page loads afresh and creates the engine with it. A dev server's
 * hot updates can leave the store the page reads apart from the one the capture feeds.
 */
async function startFresh() {
  await app(`location.reload(), true`).catch(() => {});
  await sleep(2_000);
  sessions.clear();
  await until(() => app(`typeof window.__xtendEngine === "function"`), 30_000);
  await until(async () => (await engine(`document.readyState`)) === "complete", 30_000);
  await until(() => store(`$.homeTabs.length > 0`), 20_000);
}
await startFresh();

/** The app window as it is now, to `file`. */
async function shoot(file) {
  const { call } = await session("localhost");
  const shot = await call("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
}
const sidebar = (label) =>
  app(
    `[...document.querySelectorAll("nav button, aside button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(), true`,
  );

if (PARITY !== undefined) {
  mkdirSync(PARITY, { recursive: true });
  // How Xtend opens each screen; x.com is then shown over the main area on the page the engine is on.
  const screens = [
    ["home-following", () => home("following")],
    ["home-foryou", () => home("forYou")],
    ["search", () => go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`)],
    ["post", () => app(`document.querySelector("main article p")?.click(), true`)],
    ["bookmarks", () => go("#/bookmarks")],
    ["profile", () => go("#/u/theo")],
    ["explore", () => sidebar("Explore")],
    ["notifications", () => sidebar("Notifications")],
    ["messages", () => sidebar("Messages")],
  ];
  for (const [name, open] of screens) {
    // oxlint-disable-next-line no-await-in-loop -- one screen at a time
    await open();
    // oxlint-disable-next-line no-await-in-loop -- X and the screen settle
    await sleep(6_000);
    // oxlint-disable-next-line no-await-in-loop -- one screen at a time
    await shoot(`${PARITY}/${name}-xtend.png`);
    // oxlint-disable-next-line no-await-in-loop -- one screen at a time
    const page = await enginePath();
    // oxlint-disable-next-line no-await-in-loop -- x.com over the main area, same page
    await go("#/x");
    // oxlint-disable-next-line no-await-in-loop -- the pane moves with CSS only
    await sleep(1_500);
    // oxlint-disable-next-line no-await-in-loop -- one screen at a time
    await shoot(`${PARITY}/${name}-x.png`);
    console.log(`${name}: ${page}`);
    // The search screen needs a result list to open a post from.
    if (name === "search") {
      // oxlint-disable-next-line no-await-in-loop -- one screen at a time
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
      // oxlint-disable-next-line no-await-in-loop -- the results draw
      await sleep(3_000);
    }
  }
  await go("#/home?feed=following");
  process.exit(0);
}

/** The newest bookmark on X, from a fresh load of the Bookmarks page. */
async function newestBookmark() {
  await reset("bookmarks");
  await engine(`location.href = "https://x.com/i/bookmarks", true`).catch(() => {});
  return until(() => store(`$.lists.bookmarks[0]`), 20_000);
}
const WRITES = /presses X's own button|no longer holds/;
let bookmarkBefore = chosen.some(([name]) => WRITES.test(name))
  ? await newestBookmark()
  : undefined;
bookmarkBefore ??= chosen.some(([name]) => WRITES.test(name)) ? await newestBookmark() : undefined;
const writes = bookmarkBefore !== undefined;
if (!writes && chosen.some(([name]) => WRITES.test(name)))
  console.log(
    "  (could not read the newest bookmark first, so the checks that bookmark do not run)",
  );

let streak = 0;
for (let n = 1; n <= RUNS; n++) {
  // oxlint-disable-next-line no-await-in-loop -- runs are spaced out on purpose
  if (n > 1 && PAUSE_MS > 0) await sleep(PAUSE_MS);
  if (RUNS > 1) console.log(`-- run ${n} at ${new Date().toTimeString().slice(0, 8)}`);
  // oxlint-disable-next-line no-await-in-loop -- runs are sequential by design
  streak = (await round(n)).length === 0 ? streak + 1 : 0;
}
if (writes) {
  // The bench's one write must leave the account as it found it.
  await sleep(3_000);
  const after = (await newestBookmark()) ?? (await newestBookmark());
  console.log(
    after === bookmarkBefore
      ? `bookmarks unchanged (newest ${after})`
      : `WARNING: newest bookmark was ${bookmarkBefore}, now ${after}`,
  );
  if (after !== bookmarkBefore) streak = 0;
  await go("#/home?feed=following");
}
for (const { socket } of sessions.values()) socket.close();
process.exit(streak === RUNS ? 0 : 1);
