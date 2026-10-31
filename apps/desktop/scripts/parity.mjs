// Side-by-side capture of x.com and Xtend's own X screens on a running dev desktop, for the
// parity loop: each screen is drawn natively first, then the engine's x.com page (which by then
// shows the same content) is put over the main area. Read only: it navigates and screenshots.
//   XTEND_REMOTE_DEBUG=9224 node scripts/parity.mjs [outDir] [--width 1100]
// Writes <screen>-xtend.png and <screen>-x.png per screen. Keep the output outside the repo: it
// is the user's real account.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const port = process.env.XTEND_REMOTE_DEBUG ?? "9223";
const args = process.argv.slice(2);
const widthAt = args.indexOf("--width");
const width = widthAt === -1 ? null : Number(args[widthAt + 1]);
const out =
  args.find((a, i) => !a.startsWith("--") && (widthAt === -1 || i !== widthAt + 1)) ??
  join(homedir(), "Pictures/xtend-ui/parity", new Date().toISOString().slice(0, 16));

const targets = async () =>
  (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(
    (t) => t.type === "page" && !t.url.startsWith("https://x.com"),
  );

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const own = ++id;
      const onMessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== own) return;
        socket.removeEventListener("message", onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id: own, method, params }));
    });
  return { call, close: () => socket.close() };
}

const app = (await targets())[0];
if (app === undefined) throw new Error(`no app window on DevTools port ${port}`);
const { call, close } = await connect(app);
const run = async (expression) =>
  (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result
    .value;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Waits until the expression is truthy in the app page, up to `ms`. */
const until = async (expression, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500))
    if (await run(expression)) return true;
  return false;
};
const shot = async (file) => {
  const { data } = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(out, file), Buffer.from(data, "base64"));
};
/** Runs an expression in the x.com page itself (the engine), through its own DevTools target. */
const xPage = async (expression) => {
  const x = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) =>
    t.url.startsWith("https://x.com"),
  );
  if (x === undefined) return;
  const page = await connect(x);
  await page.call("Runtime.evaluate", { expression });
  page.close();
};
const go = (hash) => run(`location.hash = ${JSON.stringify(hash)}, true`);
const POSTS = 'document.querySelectorAll("[data-x=post]").length > 0';

// Electron has no Browser.setWindowBounds; the page's own viewport narrows instead, and the
// webview, sized by the page's CSS, follows it.
if (width !== null) {
  await call("Emulation.setDeviceMetricsOverride", {
    width,
    height: 920,
    deviceScaleFactor: 0,
    mobile: false,
  });
  await sleep(800);
}
await mkdir(out, { recursive: true });

/** Each screen: its native route, and what must be on screen before the shot. */
// Following: X refetches it on load; a tab X has cached sends nothing (engine bug, see the bench).
const screens = [{ name: "home", hash: "#/home?feed=following" }];
const report = [];
for (let i = 0; i < screens.length; i++) {
  const screen = screens[i];
  await go(screen.hash);
  const drawn = await until(
    screen.ready === undefined
      ? POSTS
      : `document.querySelector(${JSON.stringify(screen.ready)}) !== null`,
  );
  await sleep(1500); // images settle
  await run(
    "document.querySelector('[data-x=column]')?.parentElement?.parentElement?.scrollTo(0, 0)",
  );
  await shot(`${screen.name}-xtend.png`);
  // The first screen names the rest after what it drew, so both sides show the same content.
  if (screen.name === "home" && drawn) {
    const first = await run(
      `(() => { const a = document.querySelector("[data-x=post]"); const h = a?.querySelector("span.truncate")?.textContent?.replace("@", ""); return a === null ? null : { id: a.dataset.post, handle: h }; })()`,
    );
    if (first?.id)
      screens.push(
        { name: "post", hash: `#/post/${first.id}?h=${first.handle ?? "i"}` },
        { name: "profile", hash: `#/u/${first.handle}` },
      );
    screens.push(
      { name: "search", hash: "#/search?q=build%20in%20public&f=top" },
      { name: "bookmarks", hash: "#/bookmarks" },
      {
        name: "notifications",
        hash: "#/notifications",
        ready: "[data-x=notification],[data-x=post]",
      },
      { name: "explore", hash: "#/explore", ready: "[data-x=trend],[data-x=post]" },
      { name: "lists", hash: "#/lists/", ready: "[data-x=list-row]" },
    );
  }
  await go("#/x");
  await sleep(2500);
  // Both sides from the top of the same page, so the pair shows the same entries.
  await xPage("window.scrollTo(0, 0)");
  await sleep(500);
  await shot(`${screen.name}-x.png`);
  report.push(`${screen.name.padEnd(10)} ${drawn ? "drawn" : "EMPTY after 20s"}`);
}
if (width !== null) await call("Emulation.clearDeviceMetricsOverride");
close();
console.log(`${out}\n${report.join("\n")}`);
