// Read-only benchmarks for the X engine under Xtend's own X screens, against a running dev
// desktop started with XTEND_REMOTE_DEBUG (see docs/internals/native-shell.md). Each check drives
// the app page, waits for what X's session sends, and passes or fails with its time. Nothing here
// clicks a button that writes to X.
//   XTEND_REMOTE_DEBUG=9223 node scripts/engine-bench.mjs
const port = process.env.XTEND_REMOTE_DEBUG ?? "9223";

async function target(match) {
  const all = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const found = all.find(
    (t) => t.url.includes(match) && (t.type === "page" || t.type === "webview"),
  );
  if (found === undefined) throw new Error(`no target matching ${match}`);
  return found;
}

/** Evaluates `expression` in the page whose URL contains `match` and returns its value. */
async function evaluate(match, expression) {
  const socket = new WebSocket((await target(match)).webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const answer = new Promise((resolve) =>
    socket.addEventListener("message", (e) => resolve(JSON.parse(String(e.data)))),
  );
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true },
    }),
  );
  const { result } = await answer;
  socket.close();
  return result?.result?.value;
}

const app = (expression) => evaluate("localhost", expression);
const engine = (expression) => evaluate("x.com", expression);
const go = (hash) => app(`location.hash = ${JSON.stringify(hash)}, true`);
const posts = () => app(`document.querySelectorAll("main article").length`);

/** Polls `check` until it returns a truthy value or `ms` pass. */
async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) return undefined;
    await new Promise((r) => setTimeout(r, 500));
  }
}

const benchmarks = [
  [
    "Home Following renders",
    async () => (
      await go("#/home?feed=following"),
      until(async () => (await posts()) >= 3, 20_000)
    ),
  ],
  [
    "Home For you renders",
    async () => (await go("#/home?feed=forYou"), until(async () => (await posts()) >= 3, 20_000)),
  ],
  [
    "Engine is on X's Home under native Home",
    () => until(async () => (await engine("location.pathname")) === "/home", 10_000),
  ],
  [
    "X's own like button exists for the first native post (in-place actions)",
    () =>
      until(
        () =>
          app(`document.querySelector("main article")?.dataset.post`).then((id) =>
            id
              ? engine(
                  `!!document.querySelector('article a[href$="/status/${id}"] time')?.closest("article")?.querySelector('[data-testid="like"],[data-testid="unlike"]')`,
                )
              : false,
          ),
        10_000,
      ),
  ],
  [
    "Feed loads more when the native list reaches its end",
    async () => {
      // More posts appended grow the list's total height; scrolling alone does not.
      const height = () =>
        app(
          `(() => { const s = document.querySelector("main [data-virtuoso-scroller]"); if (!s) return 0; s.scrollTop = s.scrollHeight; return s.scrollHeight; })()`,
        );
      const start = await height();
      if (!start) return false;
      return until(async () => (await height()) > start + 400, 25_000);
    },
  ],
  [
    "Search renders X's results, not the page before",
    async () => {
      const before = await app(`document.querySelector("main article")?.dataset.post ?? ""`);
      await go("#/search?q=filter%3Anative_video%20min_faves%3A500&f=top");
      return until(
        async () =>
          (await posts()) >= 2 &&
          (await app(`document.querySelector("main article")?.dataset.post`)) !== before,
        20_000,
      );
    },
  ],
  [
    "A video in the results plays from X's mp4",
    () =>
      until(
        () =>
          app(
            `(() => { const v = document.querySelector("main article video"); return !!v && /\\.mp4/.test(v.currentSrc || v.src) && v.readyState >= 1; })()`,
          ),
        20_000,
      ),
  ],
  [
    "Post opens with its thread and the reply composer",
    async () => {
      await app(`document.querySelector("main article p")?.click(), true`);
      return until(
        () =>
          app(
            `!!document.querySelector('textarea[aria-label="Your reply"]') && document.querySelectorAll("main article").length >= 1`,
          ),
        20_000,
      );
    },
  ],
  [
    "Bookmarks render",
    async () => (await go("#/bookmarks"), until(async () => (await posts()) >= 1, 20_000)),
  ],
  [
    "A profile renders its posts",
    async () => (await go("#/u/theo"), until(async () => (await posts()) >= 2, 20_000)),
  ],
  [
    "Back on Home, the engine follows",
    async () => (
      await go("#/home?feed=following"),
      until(async () => (await engine("location.pathname")) === "/home", 15_000)
    ),
  ],
];

let failed = 0;
for (const [name, run] of benchmarks) {
  const started = Date.now();
  const ok = await run().catch(() => false);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(Date.now() - started).padStart(6)}ms  ${name}`);
}
console.log(`${benchmarks.length - failed}/${benchmarks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
