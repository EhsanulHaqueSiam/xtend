// Drives a running dev desktop through the DevTools port XTEND_REMOTE_DEBUG opens, for hosts
// where nobody can click. Keys sent this way skip Electron's before-input-event, so chords main
// forwards from x.com (⌘K, ⌘\, ⌘F) must go to the app window. No command prints usage.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// Targets are picked by a URL substring: "x.com" is the webview, the dev URL the app window.
const USAGE = `XTEND_REMOTE_DEBUG=9223 node scripts/dev-electron.mjs   start the app with the port open
node scripts/cdp.mjs shot /tmp/xtend                     every page to /tmp/xtend-<n>.png
node scripts/cdp.mjs eval x.com 'location.href'          prints the JSON value
node scripts/cdp.mjs click x.com 470 86                  a real mouse click in CSS pixels
node scripts/cdp.mjs type x.com 'hello'                  inserts text at the focus
node scripts/cdp.mjs record localhost                     start keeping the app page's engine batches
node scripts/cdp.mjs dump localhost [file.ndjson]         write them (default ~/Pictures/xtend-ui/rec/)`;
const port = process.env.XTEND_REMOTE_DEBUG ?? "9223";
const TIMEOUT_MS = 5_000;
const [command, ...args] = process.argv.slice(2);

const pages = async () =>
  (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(
    (t) => t.type === "page" || t.type === "webview",
  );

/** Opens the page's DevTools socket and returns a `call(method, params)` plus `close`. */
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
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), TIMEOUT_MS);
      const onMessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== own) return;
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id: own, method, params }));
    });
  return { call, close: () => socket.close() };
}

async function page(match) {
  const all = await pages();
  const found = all.find((t) => t.url.includes(match));
  if (found === undefined) {
    throw new Error(`no page matches "${match}"; open: ${all.map((t) => t.url).join(", ")}`);
  }
  return connect(found);
}

const commands = {
  async shot(prefix = "/tmp/xtend") {
    const all = await pages();
    await Promise.all(
      all.map(async (target, index) => {
        const { call, close } = await connect(target);
        try {
          const { data } = await call("Page.captureScreenshot", { format: "png" });
          await NodeFSP.writeFile(`${prefix}-${index}.png`, Buffer.from(data, "base64"));
          console.log(`${prefix}-${index}.png  ${target.url}`);
        } catch (error) {
          // A parked webview (hidden off-screen) may not paint.
          console.log(`skipped ${target.url}: ${error.message}`);
        } finally {
          close();
        }
      }),
    );
  },
  async eval(match, expression) {
    const { call, close } = await page(match);
    const { result, exceptionDetails } = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    close();
    if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
    console.log(JSON.stringify(result.value));
  },
  async click(match, xs, ys) {
    const [x, y] = [Number(xs), Number(ys)];
    const { call, close } = await page(match);
    // Without a display session, Chromium drops input right after a load or a layout change
    // until something forces a frame and a hit test.
    await call("Page.captureScreenshot", { format: "png" });
    await call("Runtime.evaluate", { expression: `void document.elementFromPoint(${x}, ${y})` });
    const mouse = (type) =>
      call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await mouse("mouseMoved");
    await mouse("mousePressed");
    await mouse("mouseReleased");
    close();
  },
  // Engine batches as the app page receives them, for scripts/engine-fixture.ts scrub. A second
  // listener on the bridge, so the desktop itself is untouched; it lasts until the page reloads.
  async record(match) {
    const { call, close } = await page(match);
    const { result } = await call("Runtime.evaluate", {
      expression: `(() => {
        if (!window.__xtendRec) {
          window.__xtendRec = [];
          window.desktopBridge.onEngine((batch) => window.__xtendRec.push(batch));
        }
        return window.__xtendRec.length;
      })()`,
      returnByValue: true,
    });
    close();
    console.log(`recording engine batches (${result.value} so far); browse, then dump`);
  },
  async dump(match, file) {
    const { call, close } = await page(match);
    const { result } = await call("Runtime.evaluate", {
      expression: "JSON.stringify(window.__xtendRec ?? [])",
      returnByValue: true,
    });
    close();
    const batches = JSON.parse(result.value);
    // A recording is the real account's data: outside the repo unless asked otherwise.
    const out =
      file ??
      NodePath.join(NodeOS.homedir(), "Pictures/xtend-ui/rec", `engine-${Date.now()}.ndjson`);
    await NodeFSP.mkdir(NodePath.dirname(out), { recursive: true });
    await NodeFSP.writeFile(out, batches.map((b) => JSON.stringify(b)).join("\n") + "\n");
    console.log(`${batches.length} batches -> ${out}`);
  },
  async type(match, text) {
    const { call, close } = await page(match);
    await call("Input.insertText", { text });
    close();
  },
};

const run = commands[command];
if (run === undefined) {
  console.error(USAGE);
  process.exit(2);
}
await run(...args);
