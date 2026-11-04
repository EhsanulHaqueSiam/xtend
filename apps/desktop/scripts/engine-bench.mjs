// Benchmarks the X engine under Xtend's own X screens on a running dev desktop
// (XTEND_REMOTE_DEBUG, see docs/internals/native-shell.md). Writes stay dry: X's buttons are only
// found, never pressed, except one private bookmark that is undone. `--help` lists the flags.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  accountKey,
  BUDGET,
  estimate,
  locked,
  looksRateLimited,
  pace,
  readSpent,
} from "./bench-pace.mjs";

const USAGE = `node scripts/engine-bench.mjs [flags]
  (none)           every check once
  --runs 3         until three passes in a row, at most 3 rounds
  --pause 300      seconds between runs
  --only video     checks whose name contains "video"
  --shots DIR      a screenshot of the app after each check
  --parity DIR     per screen, Xtend's screen and x.com on the same page:
                   DIR/<screen>-xtend.png and DIR/<screen>-x.png
  --no-wait        exit instead of waiting when this account's X budget is spent
  --force          start even when it is spent

X rate-limits an account per 15 minutes. Each round counts the X calls it makes, and a round
waits until every checkout's rounds on the account in the last 15 minutes plus its own stay
within ${BUDGET} calls.`;
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
/** X's Grok requests the engine page made while the bench watched it, by kind. */
const grokSeen = { graphql: 0, stream: 0, rest: 0 };
const grokKind = (url) =>
  /\/i\/api\/graphql\/[^/]+\/[^/?]*Grok/.test(url)
    ? "graphql"
    : url.includes("/2/grok/add_response.json")
      ? "stream"
      : url.includes("grok.com/rest/app-chat")
        ? "rest"
        : null;
/** The titles in X's own last GrokHistory answer, for comparing in this process: never printed. */
let grokHistory = null;
let grokHistoryRequest = null;
/** X's API calls the engine page made while the bench watched it, for pacing. */
let xCalls = 0;
const X_API = /^https:\/\/(x\.com\/i\/api\/|api\.x\.com\/)/;
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
    if (message.method === "Network.requestWillBeSent") {
      const url = message.params.request.url;
      if (X_API.test(url)) xCalls++;
      const kind = grokKind(url);
      if (kind !== null) grokSeen[kind]++;
      if (/\/graphql\/[^/]+\/GrokHistory(?:\?|$)/.test(url))
        grokHistoryRequest = message.params.requestId;
    }
    if (
      message.method === "Network.loadingFinished" &&
      message.params.requestId === grokHistoryRequest
    )
      void call("Network.getResponseBody", { requestId: grokHistoryRequest }).then(({ result }) => {
        try {
          const text = result.base64Encoded
            ? Buffer.from(result.body, "base64").toString("utf8")
            : result.body;
          const items = JSON.parse(text).data.grok_conversation_history.items ?? [];
          // The rows Xtend draws: X's items that name their conversation.
          grokHistory = items
            .filter((i) => i.grokConversation?.rest_id ?? i.grokConversation?.id)
            .map((i) => i.title || "Untitled chat");
        } catch {
          // Not an answer the check can read; it waits for the next one.
        }
      });
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
  // shortcut: calls a new engine page makes before this attaches go uncounted (its first load's
  // dozen or so); the budget leaves room for them. Upgrade to Target auto-attach if it ever matters.
  if (match === "x.com") {
    await call("Network.enable", {});
    // X's page loads hundreds of images: a full timing buffer would drop the Grok calls checks count.
    await call("Runtime.evaluate", {
      expression: "performance.setResourceTimingBufferSize(10000)",
    });
    // What this page already called before the session attached (a fresh load's startup calls).
    const { result } = await call("Runtime.evaluate", {
      expression: `performance.getEntriesByType("resource").filter((e) => ${X_API}.test(e.name)).length`,
      returnByValue: true,
    });
    xCalls += result?.result?.value ?? 0;
  }
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
/** Posts that carry an X Article link to it under x.com/i/article. */
const ARTICLE_SEARCH = "url:x.com/i/article min_faves:100";
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
    "Post Analytics: your own post's numbers are the ones X's analytics page draws",
    async () => {
      const handle = await until(() => store(`$.viewer?.handle`));
      if (!handle) return false;
      await go(`#/u/${handle}`);
      // The user's own post, not a repost, on their profile.
      const id = await until(() =>
        store(
          `(() => { const me = [...$.users.values()].find((u) => u.handle === ${JSON.stringify(handle)}); return me && at($.lists, "profile:posts:" + me.userId).find((id) => $.posts.get(id)?.author.userId === me.userId); })()`,
        ),
      );
      if (!id) return false;
      await go(`#/post/${id}/analytics?h=${handle}`);
      // Xtend's labels and numbers in order, then the number X's page draws beside each label.
      const ours = `[...document.querySelectorAll('main [data-x="analytics"] > div')].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])`;
      const xs = (labels) =>
        `${JSON.stringify(labels)}.map((label) => { let box = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === label); while (box && !/\\d/.test(box.textContent.replace(label, ""))) box = box.parentElement; return [label, box?.textContent.replace(label, "").match(/[\\d.,]+[KM]?/)?.[0] ?? null]; })`;
      const drawn = await until(async () => {
        if (!(await enginePath()).endsWith(`/status/${id}/analytics`)) return false;
        const native = await app(ours);
        if (native?.length !== 5) return false;
        const onX = await engine(xs(native.map(([label]) => label)));
        return JSON.stringify(native) === JSON.stringify(onX) && native;
      });
      return drawn && `${id}: ${drawn.map(([label, n]) => `${label} ${n}`).join(", ")}`;
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
    "Lists: X's Pin on Your Lists and a List's Follow are found where Xtend presses them, saying what Xtend shows (dry)",
    async () => {
      // Nothing is pressed: X's buttons are only found, as listButton in apps/web/src/state/x.ts
      // finds them, and each says what Xtend's own button says.
      const handle = await until(() => store(`$.viewer?.handle`));
      if (!handle) return false;
      await reset("lists");
      await go("#/lists");
      const listed = await until(() =>
        store(
          `(() => { const ls = at($.listIds, "lists").map((id) => $.xLists.get(id)).filter(Boolean); return ls.length > 0 && ls.map((l) => ({ id: l.listId, button: l.button ?? null })); })()`,
        ),
      );
      if (!listed) return false;
      // X draws its rows anchorless: a row's List is the link in its cell's React props.
      const mine = listed.find((l) => l.button === "pin");
      let pin = "no List of yours";
      if (mine) {
        const xs = await until(() =>
          engine(
            `(() => { const id = ${JSON.stringify(mine.id)}; const pins = [...document.querySelectorAll('[data-testid="listCell"]')].flatMap((cell) => { const key = Object.keys(cell).find((k) => k.startsWith("__reactFiber$")); let f = key && cell[key]; while (f && f.memoizedProps?.link === undefined) f = f.return?.stateNode instanceof Element ? null : f.return; const pin = cell.querySelector('[data-testid="list-icon-button"]'); return f?.memoizedProps?.link?.pathname === "/i/lists/" + id && pin?.closest('[data-testid="listCell"]') === cell && /^(Pin|Unpin) List$/.test(pin.getAttribute("aria-label") ?? "") ? [pin.getAttribute("aria-label")] : []; }); return pins.length === 1 ? pins[0] : undefined; })()`,
          ),
        );
        // What Xtend's Pin shows: a press X took, else X's answer for the List, else Home's tabs.
        const ours = await store(
          `(() => { const id = ${JSON.stringify(mine.id)}; const on = $.listPins.get(id) ?? $.xLists.get(id)?.pinned ?? $.homeTabs.some((t) => t.id === "list:" + id); return on ? "Unpin List" : "Pin List"; })()`,
        );
        if (xs === undefined || ours !== xs) return false;
        pin = `${mine.id}: X's "${xs}"`;
      }
      // A List X offers to follow (Discover new Lists): X's Follow in its header on its page.
      const other = listed.find((l) => l.button === "follow");
      if (!other) return `pin ${pin}; no List to follow listed`;
      await go(`#/lists/${other.id}`);
      const xs = await until(async () => {
        if ((await enginePath()) !== `/i/lists/${other.id}`) return false;
        return engine(
          `(() => { const id = ${JSON.stringify(other.id)}; const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((b) => !b.hasAttribute("data-testid") && /^(Follow|Following|Unfollow)$/.test(b.textContent.trim())); const mine = buttons.filter((b) => { for (let box = b.parentElement; box; box = box.parentElement) { if (!box.querySelector('a[href="/i/lists/' + id + '/members"]')) continue; return buttons.every((o) => o === b || !box.contains(o)); } return false; }); return mine.length === 1 ? mine[0].textContent.trim() : undefined; })()`,
        );
      });
      const ours = await until(() =>
        app(
          `document.querySelector('main [data-x="list"] button[aria-label^="Follow"], main [data-x="list"] button[aria-label^="Following"]')?.textContent`,
        ),
      );
      return (
        xs !== undefined &&
        ours === (xs === "Unfollow" ? "Following" : xs) &&
        `pin ${pin}; ${other.id}: X's "${xs}"`
      );
    },
  ],
  [
    "Community admin: X's Create a new Community and its gear are where Xtend presses them, and X's Admin tools send a non-mod Home (dry)",
    async () => {
      // Nothing is pressed. X's create button is found as xControl in apps/web/src/state/x.ts
      // finds it; it goes where X's answer says: its form, or for an unverified account X's upsell.
      const handle = await until(() => store(`$.viewer?.handle`));
      if (!handle) return false;
      await go("#/communities");
      if (!(await until(async () => (await enginePath()) === `/${handle}/communities`)))
        return false;
      const offer = await until(() =>
        store(`$.communityCreate === undefined ? undefined : String($.communityCreate)`),
      );
      const xs = await until(() =>
        engine(
          `(() => { const found = [...new Set([...document.querySelectorAll('[aria-label="Create a new Community"]')].map((el) => el.closest('a, button, [role="button"], [role="link"]') ?? el))]; return found.length === 1 ? found[0].getAttribute("href") ?? "button" : undefined; })()`,
        ),
      );
      const ours = await app(
        `!!document.querySelector('main button[aria-label="Create a new Community"]')`,
      );
      const wants = {
        create: "/i/communities/create",
        verify: "/i/verified-get-verified",
        null: undefined,
      };
      if (offer === undefined || xs !== wants[offer] || ours !== (offer !== "null")) return false;
      // A Community the account does not moderate: X's top bar has no gear, nor has Xtend's.
      const id = await store(
        `[...$.communities.values()].find((c) => c.role === "NonMember" || c.role === "Member")?.communityId`,
      );
      if (!id) return `create: X's ${offer}; no Community to look at`;
      await go(`#/communities/${id}`);
      if (!(await until(async () => (await enginePath()) === `/i/communities/${id}`))) return false;
      await sleep(2_000);
      const gear = await engine(`!!document.querySelector('a[href="/i/communities/${id}/tools"]')`);
      const ourGear = await app(
        `!!document.querySelector('main a[aria-label="Admin tools"], main a[aria-label="Moderator tools"]')`,
      );
      if (gear || ourGear) return false;
      // Its Admin tools: X sends a non-mod Home, and Xtend follows.
      await go(`#/communities/${id}/tools`);
      const home = await until(
        async () =>
          (await enginePath()) === "/home" && (await app(`location.hash`)).startsWith("#/home"),
      );
      return home && `create: X's ${offer} (${xs}); ${id}: no gear, Admin tools sent Home`;
    },
  ],
  [
    "Community queues: a non-mod's Member requests and Reported posts are X's not-found page, in X and in Xtend (dry)",
    async () => {
      // Nothing is pressed: each queue opens on X's own page, which X refuses anyone but its mods.
      const id = await until(() =>
        store(
          `[...$.communities.values()].find((c) => c.role === "NonMember" || c.role === "Member")?.communityId`,
        ),
      );
      if (!id) return "no Community to look at";
      const seen = [];
      for (const queue of ["member_requests", "reported_tweets"]) {
        await go(`#/communities/${id}/moderation/${queue}`);
        const xs = await until(
          async () =>
            (await enginePath()) === `/i/communities/${id}/moderation/${queue}` &&
            engine(`document.body.innerText.includes("this page doesn’t exist")`),
        );
        const ours = await until(() =>
          app(
            `document.querySelector("main")?.innerText.includes("Hmm...this page doesn’t exist.")`,
          ),
        );
        if (!xs || !ours) return false;
        seen.push(queue);
      }
      return `${id}: ${seen.join(", ")} not found in X and Xtend`;
    },
  ],
  [
    "Profile people: X's tabs (Followers you know only with mutuals), each listing what X's page lists",
    async () => {
      const seen = await until(() =>
        store(
          `(() => { const me = $.viewer?.handle; const us = [...$.users.values()].filter((u) => u.handle !== me && (u.followers ?? 0) >= 1000 && (u.following ?? 0) >= 3); return us.length > 0 && us.slice(0, 8).map((u) => ({ id: u.userId, handle: u.handle })); })()`,
        ),
      );
      if (!seen) return false;
      // Profiles opened as the user would, so X counts each one's followers the account knows,
      // until there is one with any and one with none.
      const picked = new Map();
      for (const who of seen) {
        if (picked.size === 2) break;
        await go(`#/u/${who.handle}`);
        const known = await until(
          () =>
            store(
              `$.knownFollowers.has(${JSON.stringify(who.id)}) && { n: $.knownFollowers.get(${JSON.stringify(who.id)}) }`,
            ),
          15_000,
        );
        const kind = known && (known.n > 0 ? "mutuals" : "none");
        if (kind && !picked.has(kind)) picked.set(kind, { ...who, known: known.n });
      }
      if (picked.size < 2) return false;
      // As for List people: X's first rows sit together, in X's order, in the native list. A
      // tab X answered with nobody shows no rows on either side and no loading line natively.
      const rows = async (who, path) => {
        const surface = JSON.stringify(`${path}:${who.id}`);
        await go(`#/u/${who.handle}/people?tab=${path}`);
        return until(async () => {
          if ((await enginePath()) !== `/${who.handle}/${path}`) return false;
          if (!(await store(`$.cursors[${surface}] !== undefined`))) return false;
          const ours = await store(`at($.people, ${surface}).map((id) => $.users.get(id)?.handle)`);
          const xs = await engine(
            `[...document.querySelectorAll('[data-testid="UserCell"]')].slice(0, 3).map((u) => u.querySelector('a[href^="/"]')?.getAttribute("href").slice(1).toLowerCase())`,
          );
          if (ours.length === 0)
            return (
              xs.length === 0 &&
              (await app(
                `!document.querySelector('main [data-x="user"]') && !document.querySelector("main").innerText.includes("from X.")`,
              )) &&
              "nobody"
            );
          const n = Math.min(3, ours.length);
          const drawn = await app(`document.querySelectorAll('main [data-x="user"]').length`);
          const at = ours.indexOf(xs[0]);
          return (
            drawn >= n &&
            xs.length === n &&
            at !== -1 &&
            JSON.stringify(ours.slice(at, at + n)) === JSON.stringify(xs) &&
            xs.join(",")
          );
        });
      };
      // X's tabs, labels and order, as the native screen draws them.
      const tabs = (page) =>
        page(
          `[...document.querySelectorAll('main [role="tab"], [data-testid="primaryColumn"] [role="tab"]')].map((t) => t.textContent.trim())`,
        );
      const PATHS = {
        "Verified Followers": "verified_followers",
        "Followers you know": "followers_you_follow",
        Followers: "followers",
        Following: "following",
      };
      const results = [];
      for (const [kind, who] of picked) {
        if (!(await rows(who, "verified_followers"))) return false;
        const ours = await until(async () => {
          const [a, b] = [await tabs(app), await tabs(engine)];
          return a.length > 0 && JSON.stringify(a) === JSON.stringify(b) && a;
        });
        if (!ours || ours.includes("Followers you know") !== (kind === "mutuals")) return false;
        const lists = [];
        for (const label of ours) {
          const listed = await rows(who, PATHS[label]);
          if (!listed) return false;
          lists.push(`${label} ${listed}`);
        }
        results.push(`@${who.handle} (${who.known} you know): ${lists.join("; ")}`);
      }
      return results.join(" | ");
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
      // As Xtend presses it (communityButton in apps/web/src/state/x.ts): in the header that
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
    "Library Inspiration draws X's answer for X's filters, and a period pick presses X's own button (reads only)",
    async () => {
      // The section moves the engine to X's Creator Studio page and draws what X answered for the
      // filters X shows. A pick presses X's own button there, so X answers for that period.
      const path = "/i/jf/creators/inspiration/top_posts";
      const drawn = (period) =>
        until(async () => {
          if ((await enginePath()) !== path) return false;
          const x = await store(`$.inspiration`);
          if (!x || (period !== undefined && x.period !== period)) return false;
          const list = await store(
            `at($.lists, "inspiration:" + $.inspiration.engagement + ":" + $.inspiration.period + ":" + $.inspiration.language)`,
          );
          const ours = await app(
            `[...document.querySelectorAll('main article a[href*="/status/"]')].map((a) => a.getAttribute("href").split("/status/")[1]).slice(0, 3)`,
          );
          return (
            list?.length >= 3 &&
            JSON.stringify(ours) === JSON.stringify(list.slice(0, 3)) && {
              ...x,
              posts: list.length,
            }
          );
        }, 30_000);
      await go("#/library?tab=inspiration");
      const first = await drawn();
      if (!first) return false;
      const other = first.period === "Daily" ? "Weekly" : "Daily";
      const label = other === "Daily" ? "Last 24h" : "Last 7d";
      await app(
        `[...document.querySelectorAll('main [role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(label)})?.click(), true`,
      );
      const picked = await drawn(other);
      return (
        picked &&
        `${first.engagement} ${first.period} ${first.language}: ${first.posts}; ${other}: ${picked.posts}`
      );
    },
  ],
  [
    "Analyze X overview: X's own numbers and a range X's page answers, or without Premium X's paywall as X's page shows it (reads only)",
    async () => {
      // X may send no claims at all: what X's page shows (its upsell or its analytics) decides,
      // and the section shows it either way. Nothing waits on claims or reloads for them.
      await go("#/analyze?tab=x-overview");
      const ours = `document.querySelector('main [data-x-tile="Impressions"] .font-mono')?.textContent`;
      const shown = await until(
        () =>
          app(
            `(() => { if (document.querySelector("main")?.innerText.includes("Advanced analytics with Plus")) return "paywall"; return ${ours} ? "numbers" : undefined; })()`,
          ),
        30_000,
      );
      if (!shown) return false;
      const claims = await store(`String($.accountAnalytics.access)`);
      if (shown === "paywall") {
        // Xtend's Upgrade is X's page, and X's own page shows its upsell, not the numbers.
        const upgrade = await app(
          `[...document.querySelectorAll("main a")].find((a) => a.textContent.trim() === "Upgrade")?.getAttribute("href")`,
        );
        const gated = await until(() =>
          engine(
            `!document.body.innerText.includes("Account overview") && (location.pathname.startsWith("/i/premium_sign_up") || document.body.innerText.includes("Upgrade to continue"))`,
          ),
        );
        return (
          upgrade === "https://x.com/i/premium_sign_up" &&
          gated &&
          `no Premium (access ${claims}): X's page at ${await enginePath()} shows its upsell`
        );
      }
      // Xtend's Impressions, and the number X's page draws right under its own "Impressions".
      const xs = `[...document.querySelectorAll("main *")].map((e) => /^Impressions\\s*\\n\\s*([\\d,.]+[KM]?)/.exec(e.innerText)?.[1]).filter(Boolean).at(-1)`;
      const same = () =>
        until(async () => {
          const [a, b] = [await app(ours), await engine(xs)];
          return a && a === b && a;
        }, 30_000);
      const first = await same();
      if (!first) return false;
      // Another of X's ranges: Xtend presses X's own button, and both draw that range.
      const was = await store(
        `$.accountAnalytics.picking.overview ?? $.accountAnalytics.shown.overview`,
      );
      const label = was === 28 ? "7D" : "4W";
      await app(
        `[...document.querySelectorAll('main [role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(label)})?.click(), true`,
      );
      // X may show a range it holds from its own store without asking again: then Xtend shows the
      // answer it kept for it. Either way X's page and Xtend's agree on the picked range.
      const picked = await until(() =>
        app(
          `document.querySelector('main [role="tab"][aria-selected="true"]')?.textContent.trim() === ${JSON.stringify(label)}`,
        ),
      );
      const then = picked && (await same());
      return then && `${was} days: Impressions ${first}; ${label}: Impressions ${then}`;
    },
  ],
  [
    "News story and NBA league: a news row opens X's story with X's headline and posts, and the league's standings are X's (reads only)",
    async () => {
      // A news row X's Explore lists (Today's News): its story page, drawn natively.
      await go("#/explore");
      const id = await until(
        () =>
          store(
            `(() => { for (const per of Object.values($.trends)) for (const t of per) { const m = /\\/i\\/trending\\/(\\d+)/.exec(t.url); if (m) return m[1]; } })()`,
          ),
        20_000,
      );
      if (!id) return false;
      await go(`#/trending/${id}`);
      const story = await until(
        async () =>
          (await enginePath()) === `/i/trending/${id}` &&
          store(
            `(() => { const s = $.stories.get(${JSON.stringify(id)}); return s && { title: s.title, tabs: s.timelines.length }; })()`,
          ),
        30_000,
      );
      if (!story) return false;
      // Xtend's headline is X's, and its first posts are the ones X's page draws first.
      const xFirst = `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1]?.split("/")[0]).filter(Boolean).slice(0, 3)`;
      const same = await until(async () => {
        const ours = await nativeIds();
        const xs = await engine(xFirst);
        const title = await app(`document.querySelector('main [data-x="story"] h2')?.textContent`);
        const onX = await engine(
          `document.body.innerText.includes(${JSON.stringify(story.title)})`,
        );
        return (
          xs?.length > 0 &&
          title === story.title &&
          onX &&
          JSON.stringify(ours.slice(0, xs.length)) === JSON.stringify(xs) &&
          xs.length
        );
      }, 30_000);
      if (!same) return false;
      // The league page: X's standings, every team X sent drawn.
      await go("#/nba?tab=standings");
      const teams = await until(
        async () =>
          (await enginePath()) === "/i/nba/standings" &&
          store(`$.standings.flatMap((c) => c.divisions.flatMap((d) => d.teams)).length`),
        30_000,
      );
      const rows =
        teams &&
        (await until(() =>
          app(`document.querySelectorAll('main [data-x="standings"] tbody tr').length`),
        ));
      return (
        rows &&
        `story ${id}: "${story.title}", ${story.tabs} tabs, first ${same} posts as X; standings ${teams} teams, ${rows} drawn`
      );
    },
  ],
  [
    "Communities search: the Communities X finds, then its Top and Latest, are X's own (dry)",
    async () => {
      // A word from a Community the account has seen, so X finds something; nothing is pressed.
      const name = await store(`[...$.communities.values()].map((c) => c.name).join(" ")`);
      const q =
        name
          ?.split(/\W+/)
          .find((w) => w.length > 3)
          ?.toLowerCase() ?? "founders";
      const query = encodeURIComponent(q);
      const xTab = (label) =>
        until(() =>
          engine(
            `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === ${JSON.stringify(label)}`,
          ),
        );
      // The first three Communities in X's results and in Xtend's rows, by the ids they link to.
      const ids = (rows) =>
        `[...new Set([...document.querySelectorAll(${JSON.stringify(rows)})].map((a) => a.getAttribute("href")?.match(/communities\\/(\\d+)/)?.[1]).filter(Boolean))].slice(0, 3)`;
      await reset(
        `communitiesSearch:${q}`,
        `communityPostsSearch:Top:${q}`,
        `communityPostsSearch:Latest:${q}`,
      );
      await go(`#/communities?q=${query}`);
      if (!(await until(async () => (await enginePath()).startsWith("/i/communities/suggested"))))
        return false;
      const found = await until(async () => {
        const [xs, ours] = [
          await engine(ids('[data-testid="primaryColumn"] a[href*="/i/communities/"]')),
          await app(ids('main [data-x="community-row"]')),
        ];
        return xs?.length > 0 && JSON.stringify(xs) === JSON.stringify(ours) && xs.join(",");
      });
      // Each post tab is X's own page: its first three posts, in X's order, in the tab's list, and
      // the native list draws X's first. Media can leave fewer than three drawn in the window.
      const xFirst = `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1]?.split("/")[0]).filter(Boolean).slice(0, 3)`;
      const posts = async (tab, label, page) => {
        await go(`#/communities?q=${query}&tab=${tab}`);
        if (!(await until(async () => (await enginePath()).startsWith(`/i/communities/${page}`))))
          return false;
        const surface = JSON.stringify(`communityPostsSearch:${label}:${q}`);
        return (
          (await xTab(label)) &&
          until(async () => {
            const [xs, ours, drawn] = [
              await engine(xFirst),
              await store(`at($.lists, ${surface})`),
              await nativeIds(),
            ];
            return (
              xs?.length > 0 &&
              JSON.stringify(ours?.slice(0, xs.length)) === JSON.stringify(xs) &&
              drawn?.[0] === xs[0] &&
              xs.join(",")
            );
          })
        );
      };
      const top = found && (await posts("top", "Top", "top"));
      const latest = top && (await posts("latest", "Latest", "latest"));
      return latest && `"${q}": Communities ${found}; Top ${top}; Latest ${latest}`;
    },
  ],
  [
    "Sports: a team's schedule is X's, and a game's header, Top and Latest are X's (dry)",
    async () => {
      // An NBA team, whose profile X draws its schedule on. Only X's tabs are pressed.
      const handle = "Lakers";
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
      await go(`#/u/${handle}`);
      // X's carousel cards are buttons with no game id: their text, in order, against Xtend's.
      const cards = (sel) =>
        `(() => { const t = [...document.querySelectorAll(${JSON.stringify(sel)})].map((c) => c.innerText.replace(/\\s+/g, " ").trim()); return t.length > 0 && t; })()`;
      const xs = await until(() =>
        engine(
          cards(
            '[data-testid="nflProfileScheduleCarousel"] [data-testid="nflProfileScheduleGameCard"]',
          ),
        ),
      );
      const texts = await until(() => app(cards('main [data-x="game-card"]')));
      const ours = await app(
        `[...document.querySelectorAll('main [data-x="game-card"]')].map((a) => a.getAttribute("href").split("/nba/game/")[1])`,
      );
      const at = texts?.indexOf(xs?.[0]) ?? -1;
      if (
        !xs ||
        at === -1 ||
        JSON.stringify(texts.slice(at, at + xs.length)) !== JSON.stringify(xs)
      )
        return false;
      // A live game if there is one, else the latest final.
      const id = await store(
        `(() => { const ids = ${JSON.stringify(ours)}; const of = (s) => ids.filter((i) => $.games.get(i)?.status === s); return of("IN_PROGRESS")[0] ?? of("COMPLETED").at(-1); })()`,
      );
      if (!id) return false;
      await reset(`sportsGame:Top:${id}`, `sportsGame:Latest:${id}`);
      await go(`#/nba/game/${id}`);
      const top = (await xTab("Top")) && (await same());
      // Xtend's header shows the score X's own page shows.
      const score = await until(async () => {
        const ourScore = await app(
          `[...document.querySelectorAll('main [data-x="game"] [data-x="points"]')].map((p) => p.textContent).join("-")`,
        );
        const onX = await engine(
          `document.querySelector('[data-testid="primaryColumn"]')?.innerText ?? ""`,
        );
        return (
          /^\d+-\d+$/.test(ourScore ?? "") &&
          ourScore.split("-").every((n) => new RegExp(`\\b${n}\\b`).test(onX)) &&
          ourScore
        );
      });
      await app(
        `[...document.querySelectorAll('main [role="tab"]')].find((t) => t.textContent.trim() === "Latest")?.click(), true`,
      );
      const latest = (await xTab("Latest")) && (await same());
      const day = await store(`$.gameDays.get(${JSON.stringify(id)})?.length ?? 0`);
      return (
        top &&
        score &&
        latest &&
        `@${handle}: ${xs.length} of X's cards; ${id} ${score}: top ${top}, latest ${latest}, ${day} on the strip`
      );
    },
  ],
  [
    "Library Radar: X's upsell without Premium, else X's queries as X lists them (dry)",
    async () => {
      // Radar is Premium on X. Without it X's page is its upsell, and the section X's intro with
      // X's own link; with it the section draws X's queries, or X's one query for a plan X allows
      // one. Nothing is pressed.
      await go("#/library?tab=radar");
      return until(async () => {
        if ((await enginePath()) !== "/i/radar") return false;
        if (await engine(`!!document.querySelector('main a[href^="/i/premium_sign_up"]')`)) {
          const intro = await app(
            `[...document.querySelectorAll("main a")].some((a) => a.textContent.trim() === "Subscribe to Premium" && a.getAttribute("href") === "https://x.com/i/premium_sign_up")`,
          );
          return intro && "no Premium: X's upsell, and the section's intro links X's own page";
        }
        const radar = await store(`({ list: $.radar.list, limit: $.radar.limit })`);
        if (!radar?.list) return false;
        if (radar.list.length === 0)
          return (
            (await app(
              `document.querySelector("main")?.textContent.includes("Create a query and let Radar track real-time updates")`,
            )) && "Premium, no queries yet: X's form"
          );
        if (radar.limit !== null && radar.limit <= 1)
          return (
            (await app(`!!document.querySelector("main h1")`)) &&
            `Premium, X's one query: ${radar.list[0]}`
          );
        const rows = await app(`document.querySelectorAll("main li").length`);
        return rows === radar.list.length && `Premium: ${rows} queries, as X lists them`;
      }, 30_000);
    },
  ],
  [
    "Articles: X's editor and its controls, or X's Not found and Xtend's upsell without Premium (dry)",
    async () => {
      // X gives its Articles pages only to Premium; without it X answers them with Not found and
      // Xtend shows X's upsell. With it, X's page has its pen, and a draft X keeps opens X's own
      // editor, whose controls are counted. Nothing is pressed or typed: X saves only on a change.
      await go("#/articles");
      const seen = await until(async () => {
        if ((await enginePath()) !== "/compose/articles") return undefined;
        if (await engine(`!!document.querySelector('[aria-label="create"]')`)) return "premium";
        const upsell = await app(
          `[...document.querySelectorAll("main a")].some((a) => a.textContent.trim() === "Upgrade to unlock" && a.getAttribute("href") === "https://x.com/i/premium_sign_up?referring_page=level_up_content_benefits")`,
        );
        return upsell ? "upsell" : undefined;
      }, 30_000);
      if (seen === "upsell") return "no Premium: X's Not found, and Xtend shows X's upsell";
      if (seen !== "premium") return false;
      const draft = await until(
        () => store(`$.xArticles.Draft && ($.xArticles.Draft[0] ?? "none")`),
        10_000,
      );
      if (!draft) return false;
      if (draft === "none") return "Premium, X's pen, no X draft to open";
      const path = `/compose/articles/edit/${draft}`;
      await engine(
        `history.pushState(null, "", ${JSON.stringify(path)}), dispatchEvent(new PopStateEvent("popstate", { state: null })), true`,
      );
      const controls = await until(async () => {
        if ((await enginePath()) !== path) return undefined;
        const x = await engine(
          `({ title: document.querySelectorAll("main textarea").length, body: document.querySelectorAll('[data-testid="composer"] [contenteditable="true"]').length, cover: document.querySelectorAll('main input[type="file"]').length, publish: [...document.querySelectorAll('[role="button"], button')].filter((b) => b.textContent.trim() === "Publish").length })`,
        );
        return x.title === 1 && x.body === 1 && x.publish === 1 ? x : undefined;
      }, 20_000);
      await engine("history.back(), true");
      if (!controls) return false;
      return `Premium: X's editor has its title, body, ${controls.cover === 1 ? "cover input" : "no cover input yet"} and Publish`;
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
    "Edit profile on your own profile opens X's own dialog over the main area and closes with X's ✕, saving nothing (dry)",
    async () => {
      const handle = await until(() => store(`$.viewer?.handle`));
      if (!handle) return false;
      await go(`#/u/${handle}`);
      const header = `document.querySelector('main [data-x="profile"]')`;
      const button = `[...(${header}?.querySelectorAll("button") ?? [])].find((b) => /^(Edit|Set up) profile$/.test(b.textContent))`;
      const label = await until(() => app(`${button}?.textContent`), 20_000);
      if (!label) return false;
      const own = `(() => { const u = [...$.users.values()].find((u) => u.handle === ${JSON.stringify(handle)}); return u && [u.name, u.bio, u.avatarUrl, u.bannerUrl]; })()`;
      // A cold profile is still filling in from X's later answers: compare from once it settled.
      let seen = "";
      const before = await until(async () => {
        const now = JSON.stringify(await store(own));
        return now === seen ? JSON.parse(now) : ((seen = now), undefined);
      }, 10_000);
      const mode = `document.querySelector('section[aria-label="x.com"]')?.dataset.mode`;
      await app(`${button}?.click(), true`);
      // X's Edit profile on its own route with X's Save; Set up profile is X's flow for a bare one.
      const route = await until(async () => {
        const path = await enginePath();
        if ((await app(mode)) !== "main") return undefined;
        if (path.startsWith("/i/flow/setup_profile")) return path;
        return (
          path === "/settings/profile" &&
          (await engine(
            `!!document.querySelector('[data-testid="Profile_Save_Button"]') && !!document.querySelector('input[name="displayName"]')`,
          )) &&
          path
        );
      }, 15_000);
      // Out of it with X's own ✕ (its back arrow in X's compact layout): nothing was typed, so X
      // asks nothing and saves nothing.
      await engine(
        `(document.querySelector('[role="dialog"] [data-testid="app-bar-close"]') ?? document.querySelector('[data-testid="app-bar-back"]'))?.click(), true`,
      );
      const back = await until(
        async () =>
          (await app(mode)) === "hidden" &&
          (await enginePath()).toLowerCase() === `/${handle.toLowerCase()}`,
        10_000,
      );
      const after = await store(own);
      const same = JSON.stringify(before) === JSON.stringify(after);
      // Which of name, bio, avatar, banner moved, never their values.
      const moved = ["name", "bio", "avatar", "banner"].filter(
        (_, i) => before?.[i] !== after?.[i],
      );
      if (!route || !back || !same)
        return (console.log(`      ${JSON.stringify({ label, route, back, same, moved })}`), false);
      return `${label}: X's ${route} opened and closed, header unchanged`;
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
    "Bookmark folders: Premium lists X's folders and opens one on X's page; without Premium, X's upsell (dry)",
    async () => {
      await go("#/bookmarks");
      // X's claims say Premium or not when X sends them, which it may never do; else X's answers
      // do: a folder list means Premium, Bookmarks answered without one means not.
      const decided = () =>
        store(
          `$.claims ? ($.claims.has("subscriptions_feature_1002") ? "premium" : "not") : $.bookmarkFolders ? "premium" : $.cursors.bookmarks ? "not" : null`,
        );
      let kind = await until(decided, 20_000);
      // X answered nothing (it held its page from its cache): one full load, not a wait on claims.
      if (!kind) {
        await engine(`location.reload(), true`).catch(() => {});
        kind = await until(decided, 20_000);
      }
      if (!kind) return false;
      // X sends Bookmarks and its folders together: a moment for the folders before saying not.
      if (kind === "not") {
        await sleep(3_000);
        kind = await decided();
      }
      const by = (await store(`$.claims ? "X's claims" : "X's answers"`)) ?? "";
      const title = `document.querySelector('main button[aria-label$="bookmark folders"]')`;
      await until(() => app(`!!${title}`), 10_000);
      if (kind === "not") {
        // Not Premium: X sent no folders, and the title offers X's upsell with X's Upgrade.
        await app(`${title}?.click(), true`);
        const upgrade = await until(
          () =>
            app(
              `[...document.querySelectorAll("a")].find((a) => a.textContent === "Upgrade")?.getAttribute("href")`,
            ),
          5_000,
        );
        await app(`${title}?.click(), true`);
        const folders = await store(`$.bookmarkFolders`);
        if (
          upgrade !== "https://x.com/i/premium_sign_up?referring_page=bookmark_folders" ||
          folders
        )
          return (console.log(`      ${JSON.stringify({ upgrade, folders })}`), false);
        return `not Premium (by ${by}): no folders from X, X's upsell shown`;
      }
      // Premium: Xtend's menu lists X's folders in X's order, and the first opens on X's page.
      const folders = await until(() => store(`$.bookmarkFolders`), 15_000);
      if (!folders) return false;
      if (folders.length === 0) return "Premium, no folders on X";
      const rowsJs = `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((m) => m.textContent)`;
      await app(`${title}?.click(), true`);
      const rows = await until(async () => {
        const r = await app(rowsJs);
        return r?.length > 0 && r;
      }, 5_000);
      if (
        JSON.stringify(rows?.slice(1, folders.length + 1)) !==
        JSON.stringify(folders.map((f) => f.name))
      )
        return (console.log(`      ${JSON.stringify({ rows, folders })}`), false);
      const [first] = folders;
      await app(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((m) => m.textContent === ${JSON.stringify(first.name)})?.click(), true`,
      );
      const opened = await until(
        async () => (await enginePath()).endsWith(`/bookmarks/${first.folderId}`),
        15_000,
      );
      const surface = JSON.stringify(`bookmarkFolder:${first.folderId}`);
      const listed = await until(async () => {
        const [ids, list, answered] = [
          await nativeIds(),
          await store(`at($.lists, ${surface})`),
          await store(`$.cursors[${surface}] !== undefined`),
        ];
        // X's own posts in X's order, or X's answer of an empty folder.
        return ids.length > 0 ? list?.[0] === ids[0] && `${ids.length} posts` : answered && "empty";
      }, 20_000);
      await go("#/bookmarks");
      return opened && listed && `${folders.length} folders, the first ${listed}`;
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
    "A creator's Reposts and Subs: X's tabs in X's order, Reposts' posts and X's Subs prompt or posts (dry)",
    async () => {
      // A creator who offers Subscriptions today. Nothing is pressed but X's own tabs.
      const handle = "levelsio";
      const xFirst = `[...document.querySelectorAll("article")].map((a) => a.querySelector('a[href*="/status/"] time')?.parentElement.getAttribute("href")?.split("/status/")[1]?.split("/")[0]).filter(Boolean).slice(0, 3)`;
      // X's first three posts lead the tab's list, and Xtend draws X's first: a tall first post
      // can leave only one drawn in the window.
      const same = (surface) =>
        until(async () => {
          const [xs, ours, drawn] = [
            await engine(xFirst),
            await store(`at($.lists, ${JSON.stringify(surface)})`),
            await nativeIds(),
          ];
          return (
            xs?.length === 3 &&
            JSON.stringify(ours?.slice(0, 3)) === JSON.stringify(xs) &&
            drawn?.[0] === xs[0] &&
            xs.join(",")
          );
        });
      const xTab = (label) =>
        until(() =>
          engine(
            `document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim() === ${JSON.stringify(label)}`,
          ),
        );
      await go(`#/u/${handle}`);
      const id = await until(() =>
        store(
          `[...$.users.values()].find((u) => u.handle === ${JSON.stringify(handle)} && u.offersSubscriptions === true)?.userId`,
        ),
      );
      if (!id) return false;
      // The tabs both rows draw stand in the same order, and both have Reposts and Subs.
      const order = await until(async () => {
        const xs = await engine(
          `[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())`,
        );
        const ours = await app(
          `[...document.querySelectorAll('main [role="tablist"][aria-label="Profile"] [role="tab"]')].map((t) => t.textContent.trim())`,
        );
        const shared = (a, b) => a.filter((l) => b.includes(l)).join(",");
        return (
          ["Reposts", "Subs"].every((l) => xs?.includes(l) && ours?.includes(l)) &&
          shared(xs, ours) === shared(ours, xs) &&
          shared(ours, xs)
        );
      });
      if (!order) return false;
      await reset(`profile:reposts:${id}`, `profile:subs:${id}`);
      await go(`#/u/${handle}?tab=reposts`);
      const reposts =
        (await until(async () => (await enginePath()) === `/${handle}/reposts`)) &&
        (await xTab("Reposts")) &&
        (await same(`profile:reposts:${id}`));
      if (!reposts) return false;
      await go(`#/u/${handle}?tab=subs`);
      if (!(await until(async () => (await enginePath()) === `/${handle}/subs`))) return false;
      // A non-subscriber gets X's prompt, drawn in X's words; a subscriber gets the posts.
      const subs = await until(async () => {
        const prompt = await store(`$.prompts.get("profile:subs:${id}")`);
        if (prompt === undefined)
          return (await nativeIds()).length > 0 && (await same(`profile:subs:${id}`));
        const onX = await engine(
          `document.querySelector('[data-testid="primaryColumn"]')?.innerText ?? ""`,
        );
        const ours = await app(`document.querySelector('main [data-x="subs"]')?.innerText ?? ""`);
        return (
          onX.includes(prompt.body) &&
          ours.includes(prompt.header) &&
          ours.includes(prompt.body) &&
          `prompt "${prompt.header}"`
        );
      });
      return subs && `tabs ${order}; reposts ${reposts}; subs ${subs}`;
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
    "Explore For you is X's feed: trends, Who to follow, Posts For You, then paged posts",
    async () => {
      await go("#/explore");
      const id = await until(
        () => store(`$.exploreTabs.find((t) => t.id === "for_you")?.timelineId`),
        15_000,
      );
      if (!id) return false;
      const s = JSON.stringify(`explore:${id}`);
      await reset(`explore:${id}`);
      // X's first page anew: trends, then its modules and posts in X's order.
      const loaded = await visit("/explore", () =>
        store(`at($.trends, ${s}).length >= 3 && at($.lists, ${s}).length >= 5`),
      );
      if (!loaded) return false;
      const shape = await store(`(() => {
        const list = at($.lists, ${s});
        const who = list.findIndex((x) => $.modules.get(x)?.userIds.length > 0);
        const box = list.findIndex((x) => $.modules.get(x)?.userIds.length === 0);
        const post = list.findIndex((x) => $.posts.has(x));
        return who !== -1 && who < box && box < post && { box: $.modules.get(list[box]).title, trends: at($.trends, ${s}).length };
      })()`);
      if (!shape) return false;
      // Drawn in that order: a trend, Who to follow, X's header for the posts, the first post.
      const drawn = await until(() =>
        app(`(() => {
          const main = document.querySelector("main");
          const heading = [...main.querySelectorAll("h2")].find((h) => h.textContent === ${JSON.stringify(shape.box)});
          const els = [main.querySelector('[data-x="trend"]'), main.querySelector('section[data-x="module"]'), heading, main.querySelector("article[data-post]")];
          return els.every(Boolean) && els.every((el, i) => i === 0 || !!(els[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
        })()`),
      );
      if (!drawn) return false;
      // Reaching the list's end asks X's page for For you's next page, which goes under the list.
      const before = await store(`at($.lists, ${s})`);
      const grew = await until(async () => {
        await app(
          `(() => { const s = document.querySelector("main [data-virtuoso-scroller]"); if (s) s.scrollTop = s.scrollHeight; return true; })()`,
        );
        const now = await store(`at($.lists, ${s})`);
        return (
          now.length > before.length + 3 &&
          now.slice(0, before.length).join() === before.join() &&
          now.length
        );
      }, 30_000);
      return grew && `${shape.trends} trends, "${shape.box}", ${before.length} → ${grew} entries`;
    },
  ],
  [
    `Explore's first trend menu matches X's own rows (dry)`,
    async () => {
      // X's For you tab opens with posts now; Trending lists trends from its top.
      await go("#/explore");
      const trending = await until(
        () => store(`$.exploreTabs.find((t) => t.id === "trending")?.timelineId`),
        10_000,
      );
      if (!trending) return false;
      await go(`#/explore?tab=${encodeURIComponent(trending)}`);
      const more = `document.querySelector('[data-x="trend"] button[aria-label="More"]')`;
      if (!(await until(() => app(`!!${more}`), 10_000))) return false;
      const name = await store(`at($.trends, "explore:" + ${JSON.stringify(trending)})[0]?.name`);
      if (!name) return false;
      const own = `[...document.querySelectorAll('[data-testid="trend"]')].find((c) => [...c.querySelectorAll("span")].some((s) => { if (Number(getComputedStyle(s).fontWeight) < 600) return false; const copy = s.cloneNode(true); for (const img of copy.querySelectorAll("img[alt]")) img.replaceWith(img.alt); return copy.textContent.trim() === ${JSON.stringify(name)}; }))`;
      if (
        !(await until(
          () =>
            engine(
              `location.pathname === "/explore/tabs/trending" && !!(${own})?.querySelector('[data-testid="caret"]')`,
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
    "Home's GIF picker lists X's GIF search in X's order, pages it, and leaves X's search (dry)",
    async () => {
      await home("following");
      const q = "cat";
      const surface = JSON.stringify(`gifs:${q}`);
      await reset("gifs:", `gifs:${q}`);
      // Xtend's GIF button as the user clicks it: the engine opens X's own GIF search.
      await app(`document.querySelector('main button[aria-label="GIF"]')?.click(), true`);
      if (!(await until(async () => (await enginePath()) === "/i/foundmedia/search", 10_000)))
        return false;
      // Whether X sends GifSearch for its empty query (trending) or serves that from its cache.
      await sleep(3_000);
      const trending = await store(`at($.gifs, "gifs:").length`);
      // Typed as the user types into Xtend's field: React's own setter and an input event.
      await app(
        `(() => { const f = document.querySelector('[role="dialog"] input[placeholder="Search for GIFs"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, ${JSON.stringify(q)}); f.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
      );
      const first = await until(
        () => store(`at($.gifs, ${surface}).length >= 20 && at($.gifs, ${surface}).length`),
        20_000,
      );
      if (!first) return false;
      // X's first tiles, as X names them, are the ones Xtend lists, in X's order.
      const xTiles = await engine(
        `[...document.querySelectorAll('[data-testid="gifSearchGifImage"]')].slice(0, 6).map((t) => t.getAttribute("aria-label"))`,
      );
      const ours = await store(`at($.gifs, ${surface}).slice(0, 6).map((g) => g.altText ?? "GIF")`);
      // At the end of Xtend's grid, X's list scrolls on and its next page joins the store.
      const more = await until(async () => {
        await app(
          `(() => { const s = document.querySelector('[role="dialog"] [data-virtuoso-scroller]'); s?.scrollTo(0, s.scrollHeight); return true; })()`,
        );
        const n = await store(`at($.gifs, ${surface}).length`);
        return n > first && n;
      }, 20_000);
      // Back closes Xtend's picker and X's search with it.
      await app(
        `document.querySelector('[role="dialog"] button[aria-label="Back"]')?.click(), true`,
      );
      const back = await until(async () => (await enginePath()) === "/home", 10_000);
      if (JSON.stringify(xTiles) !== JSON.stringify(ours))
        console.log(`  X's tiles ${JSON.stringify(xTiles)}, Xtend's ${JSON.stringify(ours)}`);
      return (
        JSON.stringify(xTiles) === JSON.stringify(ours) &&
        more &&
        back &&
        `trending ${trending}, "${q}" ${first} then ${more} GIFs, X's tiles in X's order`
      );
    },
  ],
  [
    "Bold and italic follow X's own gate: Premium formats in Home's box, anyone else gets X's upsell (dry)",
    async () => {
      await home("following");
      // X's own gate as its Home composer draws it: its editor uncapped only when X lets the
      // account format. Claims count when X sent them; some accounts never get GetUserClaims.
      const drawn = await until(
        () =>
          engine(
            `(() => { const b = document.querySelector('[data-testid="tweetTextarea_0RichTextInputContainer"]'); return b && (getComputedStyle(b).maxHeight === "none" ? "formats" : "capped"); })()`,
          ),
        10_000,
      );
      if (!drawn) return false;
      const claims = await store(`$.claims && [...$.claims]`);
      const premium =
        (Array.isArray(claims) && claims.includes("subscriptions_feature_1014")) ||
        drawn === "formats";
      // The store has X's composer's word too, from the session view's own reading of it.
      const stored = await until(
        async () => (await store(`$.formatting`)) === (drawn === "formats"),
        10_000,
      );
      // Xtend's own box only: nothing is typed into X's composer or sent.
      const fill = (text) =>
        app(
          `(() => { const t = document.querySelector('main textarea[aria-label="Post text"]'); t.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event("input", { bubbles: true })); t.setSelectionRange(0, ${text.length}); return true; })()`,
        );
      const bold = `document.querySelector('main button[aria-label="Bold"]')`;
      await fill("bench");
      if (!(await until(() => app(`!!${bold}`), 5_000))) return false;
      await app(`${bold}.click(), true`);
      const ok = premium
        ? await until(() => app(`${bold}.getAttribute("aria-pressed") === "true"`), 5_000)
        : await until(
            () =>
              app(
                `[...document.querySelectorAll("a")].some((a) => a.textContent === "Subscribe" && a.href === "https://x.com/i/premium_sign_up?referring_page=sidebar_longform") && document.body.textContent.includes("apply text formatting such as bold and italic")`,
              ),
            5_000,
          );
      if (!premium) await app(`${bold}.click(), true`);
      await fill("");
      const said = `X's composer ${drawn}, claims ${claims === null ? "never sent" : JSON.stringify(claims)}`;
      if (!stored) console.log(`  the store missed what X's composer draws (${said})`);
      return (
        ok &&
        stored &&
        `${premium ? "Premium: Bold formats" : "not Premium: X's upsell, X's sign-up page"} (${said})`
      );
    },
  ],
  [
    "Choose audience lists X's own card: Everyone, then the user's Communities in X's order, picking nothing (dry)",
    async () => {
      await home("following");
      // X draws its card only on /compose/post: opened there, read, closed with Escape, nothing
      // picked and nothing typed (X asks to discard a draft on leaving only then).
      await engineGo("/compose/post");
      // Short steps from here, each its own call: one long script outlived the evaluate's limit.
      const fail = (step) => (console.log(`  failed at: ${step}`), false);
      const B = `document.querySelector('button[aria-label="Choose audience"]')`;
      const CARD = `document.querySelector('[data-testid="HoverCard"]:has([role="menuitem"])')`;
      if (!(await until(() => engine(`!!${B} && !${CARD}`), 6_000)))
        return fail("X's audience button");
      const before = await engine(`${B}.textContent`);
      await engine(`${B}.click(), true`);
      // X draws its rows over about a second: read them once a count above zero holds that long.
      let n = 0;
      let since = Date.now();
      const settled = await until(async () => {
        const now = await engine(`${CARD}?.querySelectorAll('[role="menuitem"]').length ?? 0`);
        if (now !== n) [n, since] = [now, Date.now()];
        return n > 0 && Date.now() - since >= 1_000;
      }, 10_000);
      const rows = settled
        ? await engine(
            `[...${CARD}.querySelectorAll('[role="menuitem"]')].map((r) => r.innerText.split("\\n")[0].trim())`,
          )
        : null;
      await engine(
        `document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), true`,
      );
      const after = await engine(`${B}?.textContent`);
      await engine(`history.back(), true`);
      await until(async () => !(await enginePath()).startsWith("/compose"), 5_000);
      // X's card stays open over its compose page until X leaves that page; then it must be gone.
      const closed = await until(() => engine(`!${CARD}`), 3_000);
      if (!settled) return fail(`X's rows (count ${n})`);
      if (!closed) return fail("X's card gone once X left /compose/post");
      const x = { rows, before, after, closed };
      // Xtend's picker lists the store's Communities, which X's card just sent.
      // Xtend's own list as the store has it once X's answer landed, mismatched or not.
      const list = `at($.communityIds, "communities:mine").map((id) => $.communities.get(id)?.name)`;
      await until(async () => (await store(list))?.length > 0, 10_000);
      const ours = await store(list);
      const same = JSON.stringify(["Everyone", ...(ours || [])]) === JSON.stringify(x.rows);
      if (!same)
        console.log(`  X's rows ${JSON.stringify(x.rows)}, Xtend's ${JSON.stringify(ours)}`);
      return (
        same &&
        x.closed &&
        x.before === "Everyone" &&
        x.after === "Everyone" &&
        `${x.rows.length - 1} Communities in X's order, nothing picked`
      );
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
    "An X Article opens in the native reader, its body read from X's reader page (dry)",
    async () => {
      // An Article this run has seen, else one from a search for posts that carry one.
      const find = () =>
        store(
          `(() => { const p = [...$.posts.values()].find((p) => p.card?.kind === "article"); return p && { id: p.postId, handle: p.author.handle, title: p.card.title }; })()`,
        );
      let found = await find();
      if (!found) {
        await go(`#/search?q=${encodeURIComponent(ARTICLE_SEARCH)}&f=top`);
        found = await until(find, 20_000);
      }
      if (!found) {
        console.log("      no Article in reach");
        return false;
      }
      const id = JSON.stringify(found.id);
      await go(`#/article/${found.id}?h=${found.handle}`);
      const path = `/${found.handle}/article/${found.id}`;
      const blocks = await until(
        async () => (await enginePath()) === path && store(`$.articles.get(${id})?.blocks.length`),
        20_000,
      );
      if (!blocks) return false;
      const drawn = await until(
        () =>
          app(
            `document.querySelector('main [data-x="article-title"]')?.textContent === ${JSON.stringify(found.title)} && !!document.querySelector('main [data-x="article-body"]')`,
          ),
        10_000,
      );
      // X's page shows the words the store read; nothing on it is pressed.
      const words = await store(
        `$.articles.get(${id}).blocks.find((b) => b.text.trim().length >= 20)?.text.trim().slice(0, 40)`,
      );
      const onX =
        words === undefined ||
        (await until(
          () => engine(`document.body.innerText.includes(${JSON.stringify(words)})`),
          10_000,
        ));
      if (!drawn || !onX) console.log(`      ${JSON.stringify({ drawn, onX, words })}`);
      return drawn && onX && `${blocks} blocks`;
    },
  ],
  [
    "Chat finds X's own composer and Send on a conversation already open, pressing nothing",
    async () => {
      // Opening a conversation marks it read in X, so the bench never opens one: it looks only at
      // one the user already has open in Chat (run it first: --only chat), and counts X's controls.
      const conversation = /^\/i\/chat\/(requests\/(other\/)?)?(\d+-\d+|g\d+)$/;
      if (
        !(await app(`location.hash.startsWith("#/chat")`)) ||
        !conversation.test(await enginePath())
      )
        return "no conversation open in Chat, so nothing to look at";
      const x = await engine(`(() => {
        const roots = [...document.querySelectorAll('[data-testid^="xchatEmbed"]')].flatMap((h) => (h.shadowRoot ? [h.shadowRoot] : []));
        const count = (s) => roots.reduce((n, r) => n + r.querySelectorAll(s).length, 0);
        // X draws its voice button in Send's place until there is text to send.
        return { field: count('[data-testid="dm-composer-textarea"]'), send: count('[data-testid="dm-composer-send-button"], [data-testid="dm-composer-voice-button"]'), accept: count('[data-testid="dm-message-request-accept-button"]') };
      })()`);
      const drawn = await app(
        `({ field: document.querySelectorAll('main textarea[aria-label="Message"]').length, accept: [...document.querySelectorAll("main button")].filter((b) => b.textContent.trim() === "Accept").length })`,
      );
      if (x.accept > 0)
        return drawn.accept === 1 && drawn.field === 0 && "X's Accept on a request, and Xtend's";
      return (
        x.field === 1 && x.send === 1 && drawn.field === 1 && "X's composer and Send, and Xtend's"
      );
    },
  ],
  [
    "Chat reads X's passcode screen or X's inbox rows, opening no conversation",
    async () => {
      await app(
        `[...document.querySelectorAll("nav button, aside button")].find((b) => b.textContent.trim() === "Chat" || b.getAttribute("aria-label") === "Chat")?.click(), true`,
      );
      // Opening a conversation marks it read in X: the check must never land on one.
      const conversation = /^\/i\/chat\/(requests\/(other\/)?)?(\d+-\d+|g\d+)/;
      // Counts only: a chat's names and words stay in X's page and the app page.
      const seen = await until(async () => {
        const path = await enginePath();
        if (!path.startsWith("/i/chat") || conversation.test(path)) return undefined;
        const x = await engine(`(() => {
          const roots = [...document.querySelectorAll('[data-testid^="xchatEmbed"]')].flatMap((h) => (h.shadowRoot ? [h.shadowRoot] : []));
          const count = (s) => roots.reduce((n, r) => n + r.querySelectorAll(s).length, 0);
          return { pin: count('[data-testid="pin-code-input-container"], [data-testid="pin-title"]'), rows: count('[data-testid^="dm-conversation-item-"]'), empty: count('[data-testid="dm-empty-inbox"]') };
        })()`);
        if (x.pin > 0)
          return (
            (await app(
              `document.querySelector('section[aria-label="x.com"]')?.dataset.mode === "main"`,
            )) && "X's passcode screen, over the main area"
          );
        if (x.rows === 0 && x.empty === 0) return undefined;
        const drawn = await app(`document.querySelectorAll('main [data-x="chat-row"]').length`);
        return drawn === x.rows && `${drawn} of X's ${x.rows} rows`;
      }, 30_000);
      const path = await enginePath();
      if (conversation.test(path)) console.log("      the engine opened a conversation");
      return !conversation.test(path) && seen;
    },
  ],
  [
    "X settings: Muted notifications draws X's own checkboxes with X's values, pressing nothing (dry)",
    async () => {
      // X's settings page in the engine, found as Xtend's reader finds it (state/xSettings.ts): the
      // detail section X labels by its header on a wide window, else X's main, as in its compact
      // layout beside Xtend's panel. Counts and states only; no checkbox is pressed.
      await go("#/settings?tab=x-notifications&x=%2Fsettings%2Fnotifications%2Fadvanced_filters");
      return until(async () => {
        if ((await enginePath()) !== "/settings/notifications/advanced_filters") return false;
        const x = await engine(
          `[...(document.querySelector('[aria-labelledby="modal-header"]') ?? document.querySelector('[aria-labelledby="detail-header"]') ?? document.querySelector("main") ?? document.createElement("i")).querySelectorAll('input[type="checkbox"]')].map((i) => i.checked)`,
        );
        const drawn = await app(
          `[...document.querySelectorAll('main input[type="checkbox"]')].map((i) => i.checked)`,
        );
        if (!x?.length || JSON.stringify(x) !== JSON.stringify(drawn)) {
          console.log(`      ${JSON.stringify({ x, drawn, width: await engine("innerWidth") })}`);
          return false;
        }
        return `${x.length} of X's filters, ${x.filter(Boolean).length} on, as X's page has them`;
      }, 20_000);
    },
  ],
  [
    "Grok reads X's history rows from X's own panel into the rail, sending nothing",
    async () => {
      // X fetches its history when its Grok page opens: from Home, so this run sees that answer.
      await go("#/home?feed=following");
      if (
        !(await until(
          async () => (await enginePath()) === "/home" && (await nativeIds()).length >= 1,
          20_000,
        ))
      )
        return undefined;
      grokHistory = null;
      await app(
        `[...document.querySelectorAll("nav button, aside button")].find((b) => b.textContent.trim() === "Grok" || b.getAttribute("aria-label") === "Grok")?.click(), true`,
      );
      // Counts only are printed: a chat's titles are compared in this process, never shown.
      return until(async () => {
        if (!(await enginePath()).startsWith("/i/grok")) return undefined;
        const x = await engine(
          `(() => ({ xweb: !!document.querySelector("fieldset[data-grok-composer]") }))()`,
        );
        // X's older Grok client is drawn by Xtend: its rail holds the rows of X's own GrokHistory.
        if (!x.xweb) {
          if (grokHistory === null) return undefined;
          const drawn = await app(
            `[...document.querySelectorAll('[data-x="grok-history-row"]')].map((b) => b.textContent.trim())`,
          );
          return (
            drawn.length === grokHistory.length &&
            grokHistory.slice(0, 5).every((title) => drawn.includes(title)) &&
            `${drawn.length} of X's ${grokHistory.length} history rows, its first titles among them`
          );
        }
        const drawn = await app(`document.querySelectorAll('[data-x="grok-history-row"]').length`);
        const empty = await app(
          `!!document.querySelector('[aria-label="History"]')?.textContent.includes("No conversations yet")`,
        );
        if (drawn === 0 && !empty) return undefined;
        // X's own History panel, opened and closed again as Xtend's read does: its rows, counted.
        const rows = await engine(`(async () => {
          const button = (document.querySelector('[data-testid="primaryColumn"]') ?? document).querySelector('[aria-haspopup="dialog"][aria-expanded]');
          // X's panel, or in X's compact layout its History page, left again with Back.
          const panel = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('input[type="search"]')) ?? (location.pathname === "/i/grok/history" ? document.querySelector('[data-testid="primaryColumn"]') : null);
          if (!button) return -1;
          if (!panel()) button.click();
          for (let i = 0; i < 50 && !panel()?.querySelector('a[href^="/i/grok/c/"]') && !panel()?.querySelector('[role="status"]'); i++) await new Promise((r) => setTimeout(r, 100));
          const n = panel()?.querySelectorAll('a[href^="/i/grok/c/"]:not([target])').length ?? -1;
          if (location.pathname === "/i/grok/history") history.back();
          else if (panel() && button.getAttribute("aria-expanded") === "true") button.click();
          return n;
        })()`);
        return rows === drawn && `${drawn} of X's ${rows} history rows`;
      }, 30_000);
    },
  ],
  [
    "Grok's backend on X's Grok page, from the requests X's page made, sending nothing",
    async () => {
      await go("#/grok");
      if (!(await until(async () => (await enginePath()).startsWith("/i/grok"), 20_000)))
        return undefined;
      await sleep(4_000);
      // Counts only, from what X's page already fetched: no URL, title or text leaves the page.
      const x = await engine(`(() => {
        const urls = performance.getEntriesByType("resource").map((r) => r.name);
        const count = (has) => urls.filter(has).length;
        return {
          xweb: !!document.querySelector("fieldset[data-grok-composer]"),
          graphql: count((u) => u.includes("/i/api/graphql/") && ["GrokHistory", "GrokPinnedConversations", "GrokConversationItemsByRestId", "GrokHome"].some((op) => u.includes("/" + op))),
          stream: count((u) => u.includes("/2/grok/add_response.json")),
          rest: count((u) => u.includes("grok.com/rest/app-chat")),
        };
      })()`);
      // Also what the bench saw since it attached, and what the window heard through the capture:
      // Xtend's rail drawing X's history means X's GrokHistory reached it.
      for (const kind of ["graphql", "stream", "rest"]) x[kind] = Math.max(x[kind], grokSeen[kind]);
      const heard = await app(
        `(() => { const h = document.querySelector('section[aria-label="History"]'); return !!h && !h.textContent.includes("Your history shows once X loads it"); })()`,
      );
      console.log(`      ${JSON.stringify({ ...x, heard })}`);
      const client = x.xweb ? "X's newer Grok client" : "X's older Grok client";
      const backend =
        x.rest > 0 && x.graphql === 0
          ? `grok.com REST (${x.rest} requests)`
          : x.graphql > 0
            ? `X's GraphQL (${x.graphql} Grok requests, ${x.stream} streamed)`
            : !x.xweb && heard
              ? "X's GraphQL (its GrokHistory reached the window)"
              : "no Grok requests yet";
      return `${client}, ${backend}`;
    },
  ],
  [
    "Back on Home, the engine follows",
    async () => (
      await go("#/home?feed=following"),
      until(async () => (await enginePath()) === "/home" && (await nativeIds()).length >= 1, 20_000)
    ),
  ],
  [
    "Explain this post finds X's own Grok button on X's Home posts, pressing nothing",
    async () => {
      // On X's Home in the app and the engine first: the check before may leave X on Grok.
      await go("#/home?feed=following");
      if (
        !(await until(
          // X's own posts too: Xtend's list may be kept from before X's page loaded anew.
          async () =>
            (await enginePath()) === "/home" &&
            (await nativeIds()).length >= 1 &&
            (await engine(`document.querySelectorAll("article").length`)) >= 1,
          20_000,
        ))
      )
        return undefined;
      // Counts only: which posts carry it is X's, per account and per post.
      const x = await engine(
        `({ posts: document.querySelectorAll("article").length, grok: document.querySelectorAll('article [aria-label="Grok actions"]').length })`,
      );
      const drawn = await app(
        `document.querySelectorAll('main [data-x="post"] [aria-label="Explain this post"]').length`,
      );
      if (x.posts === 0) return undefined;
      return x.grok > 0
        ? drawn > 0 && `X's Grok button on ${x.grok} of X's ${x.posts} posts`
        : `X draws no Grok button on its ${x.posts} posts for this account: Explain opens Grok with the post's link`;
    },
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
async function round(n, planned) {
  const failed = [];
  let emptyFailures = 0;
  const checks = [];
  const record = { n, startedAt: new Date().toISOString(), planned, calls: null, checks };
  // Written before it loads X, so a run that dies mid-round still counts; the first round takes
  // over the run's own booking, the others book their turn.
  const book = () => {
    record.startedAt = new Date().toISOString();
    report.runs.push(record);
  };
  if (n === 1) {
    book();
    saveReport();
  } else await reserve(planned, book);
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
  settle();
  console.log(`${chosen.length - failed.length}/${chosen.length} passed, ${record.calls} X calls`);
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
  for (const { socket } of sessions.values()) socket.close();
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
// The start reloads X's page and may read Bookmarks: about two checks' worth on top of a round.
const planned = estimate(RESULTS, report.account ?? undefined, chosen.length + 2);

/**
 * Every X call so far, charged to the latest round: the start's to the first, a pause's or a wait's
 * to the round before it, the final bookmark check to the last. A round's end is when its calls
 * expire; a wait's calls leave it where it was.
 */
let charged = 0;
function settle({ end = true } = {}) {
  const last = report.runs.at(-1);
  if (last === undefined) return;
  last.calls = (last.calls ?? 0) + xCalls - charged;
  if (end || last.endedAt === undefined) last.endedAt = new Date().toISOString();
  charged = xCalls;
}

/**
 * Waits until this account's X budget has room for about `calls` more, unless told not to, then
 * records the reservation with `book` in the same locked step, so two checkouts never both fit.
 */
async function reserve(calls, book) {
  for (;;) {
    const paced = await locked(RESULTS, () => {
      // What X was called since the last round's count (a pause, this wait) counts before the check.
      // A wait's calls (X's page polls while idle) count without moving the round's end, or the
      // run's own polling would keep its last round in the window forever.
      if (report.runs.length > 0 && xCalls > charged) {
        settle({ end: false });
        saveReport();
      }
      const verdict = pace(readSpent(RESULTS, report.account ?? undefined), Date.now(), calls);
      if (verdict.ok || process.argv.includes("--force")) {
        book();
        saveReport();
      }
      return verdict;
    });
    if (paced.ok) return;
    if (paced.until === null && !process.argv.includes("--force")) {
      console.error(
        `Not running: this round needs about ${calls} X calls, over the account's ${BUDGET} per 15 minutes. Narrow it with --only, or pass --force.`,
      );
      process.exit(1);
    }
    const at = paced.until === null ? "-" : new Date(paced.until).toTimeString().slice(0, 5);
    const why = `${paced.used} of ${BUDGET} X calls spent on this account in the last 15 minutes, and this round needs about ${calls}`;
    if (process.argv.includes("--force"))
      return void console.log(`  WARNING: --force: ${why}; X may answer with rate limits.`);
    if (process.argv.includes("--no-wait")) {
      console.error(`Not running: ${why}. Run again after ${at}.`);
      process.exit(1);
    }
    console.log(`  waiting until ${at}: ${why}`);
    await sleep(Math.max(paced.until - Date.now(), 1_000));
  }
}
// Booked when admitted, with what it plans to spend, so other runs pace against it before it counts.
await reserve(planned, () => {
  report.startedAt = new Date().toISOString();
  report.planned = planned;
});

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
    // No Chat: a capture of it would hold the account's own messages.
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
  const roundPlan =
    n === 1 ? planned : estimate(RESULTS, report.account ?? undefined, chosen.length);
  if (RUNS > 1) console.log(`-- run ${n} at ${new Date().toTimeString().slice(0, 8)}`);
  streak = (await round(n, roundPlan)).length === 0 ? streak + 1 : 0;
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
settle();
report.streak = streak;
saveReport();
console.log(`results -> ${reportFile}`);
for (const { socket } of sessions.values()) socket.close();
process.exit(streak === RUNS ? 0 : 1);
