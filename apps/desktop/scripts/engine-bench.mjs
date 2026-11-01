// Benchmarks the X engine under Xtend's own X screens on a running dev desktop
// (XTEND_REMOTE_DEBUG, see docs/internals/native-shell.md). Writes stay dry: X's buttons are only
// found, never pressed, except one private bookmark that is undone. `--help` lists the flags.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { accountKey, looksRateLimited, pace, readStarts } from "./bench-pace.mjs";

const USAGE = `node scripts/engine-bench.mjs [flags]
  (none)           every check once
  --runs 3         until three passes in a row, at most 3 rounds
  --pause 300      seconds between runs: X rate-limits an account per 15 minutes,
                   and a run is a few hundred calls
  --only video     checks whose name contains "video"
  --shots DIR      a screenshot of the app after each check
  --parity DIR     per screen, Xtend's screen and x.com on the same page:
                   DIR/<screen>-xtend.png and DIR/<screen>-x.png
  --force          start even when this account ran the bench too recently
                   (under 5 minutes ago, or more than 4 runs in 30 minutes)`;
if (process.argv.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

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
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) return undefined;
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
    const on = attempt === 0 && known !== undefined ? known : await bookmarkedOnX(id, handle);
    if (on === false) return true;
    if (on === true) {
      await engine(
        `${focalArticle(id)}?.querySelector('[data-testid="removeBookmark"]')?.click(), true`,
      );
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
          const path = await enginePath().catch(() => "(loading)");
          if (paths.at(-1) !== path) paths.push(path);
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
    "Reply sort: Recent re-sorts the replies as X's page orders them",
    async () => {
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
      const post = await until(() =>
        store(
          `(() => { const p = at($.lists, ${JSON.stringify(`search:Top:${SEARCH}`)}).map((id) => $.posts.get(id)).find((p) => p.metrics.replies >= 10); return p && { id: p.postId, handle: p.author.handle }; })()`,
        ),
      );
      if (!post) return false;
      await go(`#/post/${post.id}?h=${post.handle}`);
      const sortButton = `[...document.querySelectorAll("main button")].find((b) => ["Relevant", "Recent", "Likes"].includes(b.textContent.trim()))`;
      if (!(await until(() => app(`!!${sortButton}`)))) return false;
      await app(`${sortButton}.click(), true`);
      await sleep(400);
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((i) => i.textContent.trim() === "Recent")?.click(), true`,
      );
      const xReplies = `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1]).filter((id) => id && id !== ${JSON.stringify(post.id)}).slice(0, 3)`;
      return until(async () => {
        if (!(await enginePath()).endsWith(`/status/${post.id}?sort_replies=recency`)) return false;
        const ours = (await nativeIds()).filter((id) => id !== post.id).slice(0, 3);
        const xs = await engine(xReplies);
        return (
          ours.length === 3 &&
          JSON.stringify(ours) === JSON.stringify(xs) &&
          `${post.id}: ${ours.join(",")}`
        );
      });
    },
  ],
  [
    "Post activity: Quotes and Reposts list what X's page lists",
    async () => {
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
      const post = await until(() =>
        store(
          `(() => { const p = at($.lists, ${JSON.stringify(`search:Top:${SEARCH}`)}).map((id) => $.posts.get(id)).find((p) => p.metrics.quotes >= 3 && p.metrics.reposts >= 3); return p && { id: p.postId, handle: p.author.handle }; })()`,
        ),
      );
      if (!post) return false;
      // The top of the quotes, native and on X's page. Quotes are tall rows (the quoted post
      // inside), so the virtualized list draws only two at first.
      const same = async (ours, xs, n) =>
        until(async () => {
          const [a, b] = [await app(ours), await engine(xs)];
          return (
            a?.length === n && JSON.stringify(a) === JSON.stringify(b.slice(0, n)) && a.join(",")
          );
        });
      await go(`#/post/${post.id}/activity?h=${post.handle}&tab=quotes`);
      const quotes = await same(
        `[...document.querySelectorAll("main article[data-post]")].slice(0, 2).map((a) => a.dataset.post)`,
        `[...document.querySelectorAll("article")].slice(0, 2).map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1])`,
        2,
      );
      if (!quotes || !(await enginePath()).endsWith(`/status/${post.id}/quotes`)) return false;
      await app(
        `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Reposts")?.click(), true`,
      );
      // X's page keeps only the rows near its scroll, and paging scrolls it down: the people X
      // draws must sit together, in X's order, in the list the native screen draws.
      const reposts = await until(async () => {
        const ours = await store(
          `at($.people, "reposters:${post.id}").map((id) => $.users.get(id)?.handle)`,
        );
        const xs = await engine(
          `[...document.querySelectorAll('[data-testid="UserCell"]')].slice(0, 3).map((u) => u.querySelector('a[href^="/"]')?.getAttribute("href").slice(1).toLowerCase())`,
        );
        const drawn = await app(`document.querySelectorAll('main [data-x="user"]').length`);
        const at = ours?.indexOf(xs?.[0]) ?? -1;
        return (
          drawn >= 3 &&
          xs?.length === 3 &&
          at !== -1 &&
          JSON.stringify(ours.slice(at, at + 3)) === JSON.stringify(xs) &&
          xs.join(",")
        );
      });
      return reposts && `${post.id}: quotes ${quotes}; reposts ${reposts}`;
    },
  ],
  [
    "List: X's header, and members and followers as X's pages list them",
    async () => {
      await go("#/lists");
      const list = await until(() =>
        store(
          `(() => { const l = [...$.xLists.values()].find((l) => (l.members ?? 0) >= 3 && (l.followers ?? 0) >= 3); return l && { id: l.listId, name: l.name, members: l.members }; })()`,
        ),
      );
      if (!list) return false;
      await go(`#/lists/${list.id}`);
      const header = await until(() =>
        app(
          `(() => { const t = document.querySelector('main [data-x="list"]')?.innerText ?? ""; return t.includes(${JSON.stringify(list.name)}) && t.includes("Members") && t; })()`,
        ),
      );
      if (!header) return false;
      // As for reposters: X's page keeps only the rows near its scroll, so X's first three must
      // sit together, in X's order, in the native list.
      const people = async (of, surface) => {
        await go(`#/lists/${list.id}/people?of=${of}`);
        return until(async () => {
          if (!(await enginePath()).endsWith(`/i/lists/${list.id}/${of}`)) return false;
          const ours = await store(
            `at($.people, "${surface}:${list.id}").map((id) => $.users.get(id)?.handle)`,
          );
          const xs = await engine(
            `[...document.querySelectorAll('[data-testid="UserCell"]')].slice(0, 3).map((u) => u.querySelector('a[href^="/"]')?.getAttribute("href").slice(1).toLowerCase())`,
          );
          const drawn = await app(`document.querySelectorAll('main [data-x="user"]').length`);
          const at = ours?.indexOf(xs?.[0]) ?? -1;
          return (
            drawn >= 3 &&
            xs?.length === 3 &&
            at !== -1 &&
            JSON.stringify(ours.slice(at, at + 3)) === JSON.stringify(xs) &&
            xs.join(",")
          );
        });
      };
      const members = await people("members", "listMembers");
      const followers = members && (await people("followers", "listFollowers"));
      return followers && `${list.id}: members ${members}; followers ${followers}`;
    },
  ],
  [
    "Follow page: Who to follow and Creators list what X lists, with X's own buttons (dry)",
    async () => {
      // Each tab: X's first three people are drawn together, in X's order, on the native screen,
      // each with X's button for them (Follow or Subscribe), and that button is on X's page for
      // the first of them. X's page keeps only the rows near its scroll. Nothing is pressed.
      const tab = async (search, path, button) => {
        await go(`#/follow${search}`);
        return until(async () => {
          if ((await enginePath()) !== path) return false;
          const xs = await engine(
            `[...document.querySelectorAll('[data-testid="UserCell"]')].slice(0, 3).map((u) => u.querySelector('a[href^="/"]')?.getAttribute("href").slice(1).toLowerCase())`,
          );
          // Each drawn row: its handle (the avatar's label) and its last button, X's own.
          const rows = await app(
            `[...document.querySelectorAll('main [data-x="user"]')].map((r) => { const b = [...r.querySelectorAll("button")]; return [b[0]?.getAttribute("aria-label")?.slice(1), b.at(-1)?.textContent.toLowerCase()]; })`,
          );
          const at = rows?.findIndex(([h]) => h === xs?.[0]) ?? -1;
          if (xs?.length !== 3 || at === -1) return false;
          const drawn = rows.slice(at, at + 3);
          if (JSON.stringify(drawn.map(([h]) => h)) !== JSON.stringify(xs)) return false;
          // Native rows draw Follow (or Following) or Subscribe, as X's do.
          if (!drawn.every(([, label]) => label?.startsWith(button[0]))) return false;
          const id = await store(
            `[...$.users.values()].find((u) => u.handle === ${JSON.stringify(xs[0])})?.userId`,
          );
          const xButton = await engine(
            `!!document.querySelector('${button.map((b) => `[data-testid="${id}-${b}"]`).join(", ")}')`,
          );
          return xButton && xs.join(",");
        });
      };
      const who = await tab("", "/i/connect_people", ["follow", "unfollow"]);
      const creators =
        who &&
        (await tab("?tab=creators", "/i/connect_people?is_creator_only=true", ["subscribe"]));
      return creators && `who ${who}; creators ${creators}`;
    },
  ],
  [
    "Communities: the hub's tabs and a Community's posts are X's, and X's Join is found (dry)",
    async () => {
      // X's first three posts sit together, in X's order, in the native list (an ad has no
      // timestamp link). Nothing is pressed: X's membership button is only found.
      const xFirst = `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1]?.split("/")[0]).filter(Boolean).slice(0, 3)`;
      const same = () =>
        until(async () => {
          const [xs, ours] = [await engine(xFirst), await nativeIds()];
          const at = ours?.indexOf(xs?.[0]) ?? -1;
          return (
            xs?.length === 3 &&
            at !== -1 &&
            JSON.stringify(ours.slice(at, at + 3)) === JSON.stringify(xs) &&
            xs.join(",")
          );
        });
      const xTab = (label) =>
        until(() =>
          engine(
            `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === ${JSON.stringify(label)}`,
          ),
        );
      await reset("communities:home", "communities:explore", "communities:mine");
      await go("#/communities");
      const home = (await xTab("Home")) && (await same());
      const tiles = await until(() =>
        app(`document.querySelectorAll('main [data-x="community-tile"]').length || false`),
      );
      if (!home || !tiles) return false;
      await go("#/communities?tab=explore");
      const explore = (await xTab("Explore")) && (await same());
      // One the account has not joined, so X draws Join or Ask to join; any, failing that.
      const id = await store(
        `(() => { const cs = [...$.communities.values()]; return (cs.find((c) => c.role === "NonMember") ?? cs.find((c) => c.role !== null))?.communityId; })()`,
      );
      if (!explore || !id) return false;
      await reset(`community:${id}`);
      await go(`#/communities/${id}`);
      const top = (await xTab("Top")) && (await same());
      // As Xtend presses it (communityJoinButton in apps/web/src/state/x.ts): in the header that
      // links into this Community alone.
      const xs = await until(() =>
        engine(
          `(() => { const id = ${JSON.stringify(id)}; const join = [...document.querySelectorAll('button, [role="button"]')].filter((b) => /^(Join|Ask to join|Joined|Requested|Pending)$/.test(b.textContent.trim()) || /^(Join|Ask to join) /.test(b.getAttribute("aria-label") ?? "")); const mine = join.filter((b) => { for (let box = b.parentElement; box; box = box.parentElement) { const links = [...box.querySelectorAll('a[href*="/i/communities/"]')].map((a) => a.getAttribute("href").split("/i/communities/")[1]?.split(/[/?#]/)[0]); if (links.length > 0) return links.every((l) => l === id) && join.every((o) => o === b || !box.contains(o)); } return false; }); return mine.length === 1 ? mine[0].textContent.trim() : undefined; })()`,
        ),
      );
      // Xtend's button says what X's does, from what X sent of the viewer's role.
      const ours = await until(() =>
        app(`document.querySelector('main [data-x="community"] button[aria-label]')?.textContent`),
      );
      return (
        top &&
        xs !== undefined &&
        ours === xs &&
        `home ${home} (${tiles} Communities); explore ${explore}; ${id}: ${top}, X's "${xs}"`
      );
    },
  ],
  [
    "Profile bell: shows X's own state for someone you follow (dry)",
    async () => {
      // Following holds people the account follows (and what they reposted), so X draws their bell.
      await go("#/home?feed=following");
      const handle = await until(() =>
        store(
          `(() => { const p = $.lists.following.map((id) => $.posts.get(id)).find((p) => p && $.users.get(p.author.userId)?.youFollow === true); return p?.author.handle; })()`,
        ),
      );
      if (!handle) return false;
      await go(`#/u/${handle}`);
      const bell = `[aria-label="Turn on post notifications"], [aria-label="Turn off post notifications"]`;
      return until(async () => {
        const ours = await app(
          `document.querySelector('main [data-x="profile"]')?.querySelector('${bell}')?.getAttribute("aria-label")`,
        );
        const xs = await engine(`document.querySelector('${bell}')?.getAttribute("aria-label")`);
        return typeof ours === "string" && ours === xs && `@${handle}: ${ours}`;
      });
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
    `A profile's "..." holds X's own rows, and About this account opens X's page over the main area`,
    async () => {
      await go("#/u/theo");
      const more = `document.querySelector('[data-x="profile"] button[aria-label="More"]')`;
      if (!(await until(() => app(`!!${more}`), 10_000))) return false;
      const started = Date.now();
      await app(`${more}.click(), true`);
      const rowsJs = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent)`;
      const rows = await until(async () => {
        const r = await app(rowsJs);
        return r?.length > 0 && r[0] !== "Loading from X" && r;
      }, 10_000);
      const ms = Date.now() - started;
      // X's menu was read and closed again on the engine page; nothing in it was pressed.
      const closed = await engine(`!document.querySelector('[data-testid="Dropdown"]')`);
      const fromX = ["About this account", "Mute", "Block @theo", "Report @theo"].every((label) =>
        rows?.includes(label),
      );
      if (!fromX || !closed) {
        console.log(`      ${JSON.stringify({ rows, closed })}`);
        return false;
      }
      const mode = `document.querySelector('section[aria-label="x.com"]')?.dataset.mode`;
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === "About this account")?.click(), true`,
      );
      const over = await until(
        async () =>
          (await app(mode)) === "main" &&
          (await enginePath()) === "/theo/about" &&
          (await app(`location.hash`)).startsWith("#/u/theo"),
        15_000,
      );
      // Out of X's page with X's own back arrow.
      await engine(`document.querySelector('[data-testid="app-bar-back"]')?.click(), true`);
      const back = await until(
        async () => (await app(mode)) === "hidden" && (await enginePath()) === "/theo",
        10_000,
      );
      return over && back && `${rows.length} rows in ${ms}ms`;
    },
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
    `Explore's first trend menu matches X's own rows (dry)`,
    async () => {
      await go("#/explore");
      const more = `document.querySelector('[data-x="trend"] button[aria-label="More"]')`;
      if (!(await until(() => app(`!!${more}`), 10_000))) return false;
      const name = await store(`at($.trends, "explore:" + $.exploreTabs[0].timelineId)[0]?.name`);
      if (!name) return false;
      const own = `[...document.querySelectorAll('[data-testid="trend"]')].find((c) => [...c.querySelectorAll("span")].some((s) => { if (Number(getComputedStyle(s).fontWeight) < 600) return false; const copy = s.cloneNode(true); for (const img of copy.querySelectorAll("img[alt]")) img.replaceWith(img.alt); return copy.textContent.trim() === ${JSON.stringify(name)}; }))`;
      if (
        !(await until(
          () =>
            engine(
              `location.pathname === "/explore" && !!(${own})?.querySelector('[data-testid="caret"]')`,
            ),
          10_000,
        ))
      )
        return false;
      const xs = await engine(`(async () => {
        const trend = ${own};
        const trigger = trend?.querySelector('[data-testid="caret"]');
        if (!trigger) return null;
        trigger.click();
        let items = [];
        for (let i = 0; i < 20 && items.length === 0; i++) {
          await new Promise((r) => setTimeout(r, 100));
          items = [...document.querySelectorAll('[data-testid="Dropdown"] [role="menuitem"]')];
        }
        const rows = items.map((i) => i.textContent.trim());
        const opened = items[0]?.closest('[role="menu"]');
        [...(opened?.parentElement?.children ?? [])].find((k) => k !== opened && k.getBoundingClientRect().height > 0)?.click();
        return rows;
      })()`);
      await app(`${more}.click(), true`);
      const ours = await until(async () => {
        const rows = await app(
          `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((i) => i.textContent)`,
        );
        return rows?.includes("Not interested in this") && rows;
      }, 10_000);
      const closed = await engine(`!document.querySelector('[data-testid="Dropdown"]')`);
      await app(
        `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`,
      );
      return (
        closed &&
        xs?.length > 0 &&
        JSON.stringify(xs) === JSON.stringify(ours) &&
        `${xs.length} rows, nothing pressed`
      );
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
    `A post's "..." holds X's own rows, and Report opens X's own dialog over the main area (never sent)`,
    async () => {
      await home("following");
      const id = await heldByEngine('[data-testid="caret"]');
      if (!id) return false;
      const started = Date.now();
      await app(
        `document.querySelector('[data-post="${id}"] button[aria-label="More"]')?.click(), true`,
      );
      const rowsJs = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent)`;
      const rows = await until(async () => {
        const r = await app(rowsJs);
        return r?.length > 0 && r[0] !== "Loading from X" && r;
      }, 10_000);
      const ms = Date.now() - started;
      // X's menu was read and closed again on the engine page; nothing in it was pressed.
      const closed = await engine(`!document.querySelector('[data-testid="Dropdown"]')`);
      const fromX = ["Report post", "Mute", "Block @"].every((label) =>
        rows?.some((r) => r.startsWith(label)),
      );
      if (!fromX || !closed) {
        console.log(`      ${JSON.stringify({ id, rows, closed })}`);
        return false;
      }
      const mode = `document.querySelector('section[aria-label="x.com"]')?.dataset.mode`;
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === "Report post")?.click(), true`,
      );
      const over = await until(
        async () =>
          (await app(mode)) === "main" &&
          (await enginePath()).startsWith("/i/safety/report") &&
          (await app(`location.hash`)).startsWith("#/home"),
        15_000,
      );
      // Out of X's report flow the way its own close does, before any choice is made.
      await engine(`history.back(), true`);
      const back = await until(
        async () => (await app(mode)) === "hidden" && (await enginePath()) === "/home",
        10_000,
      );
      return over && back && `${rows.length} rows in ${ms}ms`;
    },
  ],
  [
    "Share holds X's own share rows, and Send via Chat opens X's own sheet over the main area (never sent)",
    async () => {
      await home("following");
      const id = await heldByEngine('[role="group"] button[aria-label="Share post"]');
      if (!id) return false;
      await app(
        `document.querySelector('[data-post="${id}"] button[aria-label="Share post"]')?.click(), true`,
      );
      const rowsJs = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent)`;
      const rows = await until(async () => {
        const r = await app(rowsJs);
        return r?.length > 0 && !r.includes("Loading from X") && r;
      }, 10_000);
      // X's menu was read and closed again on the engine page; nothing in it was pressed.
      const closed = await engine(`!document.querySelector('[data-testid="Dropdown"]')`);
      if (!rows?.includes("Send via Chat") || !rows.includes("Copy link") || !closed) {
        console.log(`      ${JSON.stringify({ id, rows, closed })}`);
        return false;
      }
      const mode = `document.querySelector('section[aria-label="x.com"]')?.dataset.mode`;
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === "Send via Chat")?.click(), true`,
      );
      const over = await until(
        async () =>
          (await app(mode)) === "main" && (await enginePath()).startsWith("/messages/compose"),
        15_000,
      );
      // Out of X's sheet the way its own back arrow does, before any recipient is picked.
      await engine(`history.back(), true`);
      const back = await until(
        async () => (await app(mode)) === "hidden" && (await enginePath()) === "/home",
        10_000,
      );
      return over && back && rows.join(", ");
    },
  ],
  [
    "Repost opens X's Repost / Quote popover, and Quote opens the quote box over that post (never sent)",
    async () => {
      await home("following");
      const id = await heldByEngine('[data-testid="retweet"]');
      if (!id) return false;
      await app(
        `document.querySelector('[data-post="${id}"] button[aria-label="Repost"]')?.click(), true`,
      );
      const rowsJs = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent)`;
      const rows = await until(async () => {
        const r = await app(rowsJs);
        return r?.length > 0 && r;
      }, 5_000);
      if (rows?.join() !== "Repost,Quote") {
        console.log(`      ${JSON.stringify({ id, rows })}`);
        return false;
      }
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === "Quote")?.click(), true`,
      );
      const box = await until(
        () =>
          app(
            `!!document.querySelector('[role="dialog"][aria-label="Quote"] [data-quote="${id}"]') && document.activeElement?.getAttribute("aria-label") === "Your comment"`,
          ),
        5_000,
      );
      // Closed the way the user would, before anything is typed or posted.
      await app(
        `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`,
      );
      const closed = await until(() => app(`!document.querySelector('[role="dialog"]')`), 5_000);
      return box && closed;
    },
  ],
  [
    "X's own translation shows on a native post, with Show original, as X draws it",
    async () => {
      await go(`#/search?q=${encodeURIComponent("lang:es min_faves:200")}&f=top`);
      // A post X translated, drawn natively, whose X article says the same.
      const id = await until(async () => {
        const ids = await store(
          `[...$.posts.values()].filter((p) => p.translation?.from === "es").map((p) => p.postId)`,
        );
        const shown = await app(
          `[...document.querySelectorAll("main article[data-post]")].filter((a) => a.textContent.includes("Translated from Spanish")).map((a) => a.dataset.post)`,
        );
        return shown?.find((s) => ids?.includes(s));
      }, 20_000);
      if (!id) return false;
      const onX = await engine(
        `!!${xArticle(id)}?.querySelector('button[aria-label="Show original"]')`,
      );
      const text = () =>
        app(
          `[...document.querySelector('main article[data-post="${id}"]').querySelectorAll("p")].map((p) => p.textContent).find((t) => t.length > 0 && !/^(Translated from|Show )/.test(t))`,
        );
      const toggle = `[...document.querySelector('main article[data-post="${id}"]').querySelectorAll("button")].find((b) => /^Show (original|translation)$/.test(b.textContent)).click(), true`;
      const translated = await text();
      await app(toggle);
      const original = await text();
      await app(toggle);
      const want = await store(
        `(() => { const p = $.posts.get("${id}"); return [p.translation.text, p.text]; })()`,
      );
      // A list clamps a long post with "Show more": the opening is what shows.
      const opens = (shown, full) =>
        !!shown && full.startsWith(shown.replace(/…?Show more$/, "").slice(0, 100));
      const ok =
        onX && opens(translated, want[0]) && opens(original, want[1]) && translated !== original;
      if (!ok) console.log(`      ${JSON.stringify({ id, onX, translated, original, want })}`);
      return ok && `post ${id}`;
    },
  ],
  [
    "An open poll's choices are X's own radios on the engine (dry)",
    async () => {
      const radios = (root) =>
        `[...(${root})?.querySelectorAll('[role="radio"]') ?? []].map((r) => r.textContent.trim())`;
      for (const q of ["quick poll", "poll", "vote poll"]) {
        await go(`#/search?q=${encodeURIComponent(q)}&f=latest`);
        const id = await until(
          () =>
            app(
              `document.querySelector('main article[data-post] [data-x="poll"] [role="radio"]')?.closest("article").dataset.post`,
            ),
          10_000,
        );
        if (!id) continue;
        const ours = await app(radios(`document.querySelector('main article[data-post="${id}"]')`));
        // X's page may still be drawing the list the native one already shows from the store.
        const xs =
          (await until(async () => {
            const r = await engine(
              radios(`${xArticle(id)}?.querySelector('[data-testid="cardPoll"]')`),
            );
            return r?.length > 0 && r;
          }, 10_000)) ?? [];
        const same = ours.length >= 2 && JSON.stringify(ours) === JSON.stringify(xs);
        if (!same) console.log(`      ${JSON.stringify({ id, ours, xs })}`);
        return same && `${q}: ${ours.join(" / ")}`;
      }
      console.log("      no open poll in reach");
      return false;
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
if (SHOTS !== undefined) NodeFS.mkdirSync(SHOTS, { recursive: true });

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

const git = (...args) =>
  NodeChildProcess.spawnSync("git", args, {
    cwd: import.meta.dirname,
    encoding: "utf8",
  }).stdout.trim();
const branch = git("branch", "--show-current");
const report = {
  branch: branch || "detached",
  // Which account ran it, for pacing: a hash of X's user id, never the handle.
  account: null,
  commit: git("rev-parse", "HEAD"),
  startedAt: new Date().toISOString(),
  flags: { runs: RUNS, pause: PAUSE_MS / 1000, only: ONLY ?? null },
  runs: [],
  streak: 0,
  bookmarks: null,
};
// For comparing runs and citing one in a PR; outside the repo, as it names the account's posts.
const RESULTS = NodePath.join(NodeOS.homedir(), "Pictures/xtend-ui/bench");
const reportFile = NodePath.join(
  RESULTS,
  branch.replaceAll("/", "-") || "detached",
  `${report.startedAt.replaceAll(":", "-")}.json`,
);
// Replaced whole (temp file, then rename): pacing reads these while another run may write one.
const saveReport = () => {
  NodeFS.mkdirSync(NodePath.dirname(reportFile), { recursive: true });
  const draft = `${reportFile}.${process.pid}.tmp`;
  NodeFS.writeFileSync(draft, JSON.stringify(report, null, 2) + "\n");
  NodeFS.renameSync(draft, reportFile);
};

/** One pass over the chosen checks; the names that failed. */
async function round(n) {
  const failed = [];
  let emptyFailures = 0;
  const checks = [];
  report.runs.push({ n, startedAt: new Date().toISOString(), checks });
  // Before the first check loads X, so a run that dies mid-round still counts for pacing.
  saveReport();
  for (const [index, [name, run]] of chosen.entries()) {
    await sameAppPage();
    primed = true;
    const started = Date.now();
    // Every page the engine passes through during the check, for the failure note.
    const trail = [];
    let tracing = true;
    const tracer = (async () => {
      // oxlint-disable-next-line no-unmodified-loop-condition -- the round clears it when done
      while (tracing) {
        const path = await enginePath().catch(() => "(loading)");
        if (trail.at(-1) !== path) trail.push(path);
        await sleep(250);
      }
    })();
    const value =
      WRITES.test(name) && !writes
        ? false
        : await run().catch((error) => (console.error(`  ${name}: ${error.message}`), false));
    tracing = false;
    await tracer;
    const ok = Boolean(value);
    if (!ok) {
      failed.push(name);
      // Where things stood, to tell a slow X from a broken step.
      const where = await Promise.all([
        app(`location.hash + " batches " + window.__xtendBatches`),
        enginePath(),
        nativeIds().then((ids) => ids.slice(0, 3)),
        store(
          `Object.entries($.lists).filter(([k, l]) => l.length > 0 && !k.startsWith("post:")).map(([k, l]) => k + "=" + l.length + ":" + l[0]).join(" ").slice(0, 400)`,
        ),
      ]).catch((error) => [error.message]);
      if (where[3] === "") emptyFailures++;
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
    checks.push({ name, ok, ms: Date.now() - started, detail: detail === "" ? null : value });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${String(Date.now() - started).padStart(6)}ms  ${name}${detail}`,
    );
    if (SHOTS !== undefined) {
      const { call } = await session("localhost");
      const shot = await call("Page.captureScreenshot", { format: "png" });
      NodeFS.writeFileSync(
        `${SHOTS}/run${n}-${String(index + 1).padStart(2, "0")}.png`,
        Buffer.from(shot.result.data, "base64"),
      );
    }
  }
  const cleaned = touched.size > 0;
  for (const [id, handle] of touched) {
    if (!(await unbookmark(id, handle)))
      console.log(`  WARNING: could not remove the bench's bookmark on ${handle}/${id}`);
  }
  touched.clear();
  if (cleaned) await go("#/home?feed=following");
  console.log(`${chosen.length - failed.length}/${chosen.length} passed`);
  if (looksRateLimited(emptyFailures))
    console.log(
      `  ${emptyFailures} checks failed with the engine's lists empty: X may be rate-limiting this account. Wait 15 to 30 minutes before the next run.`,
    );
  saveReport();
  return failed;
}

// X's buttons refuse every press while session actions are off, and a seeded dev home starts
// with them off (apps/server/scripts/devData.ts): the press checks would fail with no reason.
const settings = await app(
  `fetch("/api/rpc/settings.get", { method: "POST", headers: { authorization: "Bearer " + window.desktopBridge.serviceToken, "content-type": "application/json" }, body: "{}" }).then((r) => r.json())`,
).catch((error) => error.message);
const sessionActions = settings?.sessionPostingEnabled;
if (sessionActions !== true) {
  console.error(
    sessionActions === false
      ? 'Session actions are off for this dev home, so the press checks cannot pass. Turn on Settings, X session, "Act through my X session for what I click" in the dev desktop, then run again.'
      : `Could not read the app's settings (got ${JSON.stringify(settings)}); is the dev service up?`,
  );
  process.exit(1);
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
// Paced across invocations, before anything reloads X: the account's id comes from the store
// as the idle engine left it, or X's twid cookie. Unknown, every recorded run counts.
const userId =
  (await store(`$.viewer?.userId ?? null`).catch(() => null)) ??
  (await engine(`decodeURIComponent(document.cookie).match(/twid=u=(\\d+)/)?.[1] ?? null`).catch(
    () => null,
  ));
report.account = typeof userId === "string" ? accountKey(userId) : null;
const paced = pace(readStarts(RESULTS, report.account ?? undefined), Date.now());
if (!paced.ok) {
  const at = new Date(paced.until).toTimeString().slice(0, 5);
  if (!process.argv.includes("--force")) {
    console.error(
      `Not running: ${paced.why}, and X rate-limits the account. Run again after ${at}, or pass --force.`,
    );
    process.exit(1);
  }
  console.log(
    `  WARNING: --force: ${paced.why}; X may answer with rate limits (wait until ${at}).`,
  );
}
// Written now, so a run that dies before its first round still counts for the next one's pacing.
saveReport();

await startFresh();

/** The app window as it is now, to `file`. */
async function shoot(file) {
  const { call } = await session("localhost");
  const shot = await call("Page.captureScreenshot", { format: "png" });
  NodeFS.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
}
const sidebar = (label) =>
  app(
    `[...document.querySelectorAll("nav button, aside button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click(), true`,
  );

if (PARITY !== undefined) {
  NodeFS.mkdirSync(PARITY, { recursive: true });
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
    await open();
    await sleep(6_000);
    await shoot(`${PARITY}/${name}-xtend.png`);
    const page = await enginePath();
    await go("#/x");
    await sleep(1_500);
    await shoot(`${PARITY}/${name}-x.png`);
    console.log(`${name}: ${page}`);
    // The search screen needs a result list to open a post from.
    if (name === "search") {
      await go(`#/search?q=${encodeURIComponent(SEARCH)}&f=top`);
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
  if (n > 1 && PAUSE_MS > 0) await sleep(PAUSE_MS);
  if (RUNS > 1) console.log(`-- run ${n} at ${new Date().toTimeString().slice(0, 8)}`);
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
  report.bookmarks = { before: bookmarkBefore, after };
  await go("#/home?feed=following");
}
report.streak = streak;
saveReport();
console.log(`results -> ${reportFile}`);
for (const { socket } of sessions.values()) socket.close();
process.exit(streak === RUNS ? 0 : 1);
