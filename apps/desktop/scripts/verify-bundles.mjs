// Runs both built preloads (after `vp pack`) as Electron's sandbox would, so a shared chunk or a
// dynamic require fails here instead of as a blank window. The app preload must expose every
// DesktopBridge function, the x.com preload must listen on every channel main sends.
//   node scripts/verify-bundles.mjs
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeTimers from "node:timers";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";

const TIMEOUT_MS = 1_000;

const stubElement = () => ({
  style: {},
  dataset: {},
  setAttribute() {},
  addEventListener() {},
  append() {},
  attachShadow: () => ({ append() {} }),
});

/** Executes a preload and records what it exposed and which channels it subscribed to. */
function run(source, filename) {
  const exposed = new Map();
  const subscribed = new Set();
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) },
    ipcRenderer: {
      on: (channel) => subscribed.add(channel),
      off() {},
      send() {},
      sendSync: () => undefined,
      invoke: () => Promise.resolve(undefined),
    },
  };
  const modules = new Map([
    ["electron", electron],
    ["events", NodeEvents.default],
    ["timers", NodeTimers.default],
    ["url", NodeURL.default],
  ]);
  const require = (name) => {
    const id = name.replace(/^node:/, "");
    if (!modules.has(id)) {
      throw new Error(`${filename} requires "${name}", which a sandboxed preload cannot load`);
    }
    return modules.get(id);
  };
  const window = { addEventListener() {}, location: { pathname: "/" } };
  const document = { addEventListener() {}, createElement: stubElement, body: stubElement() };
  NodeVM.runInNewContext(
    source,
    {
      require,
      module: { exports: {} },
      exports: {},
      process: { platform: "darwin", contextIsolated: true, versions: {} },
      window,
      document,
      location: window.location,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame() {},
      setTimeout,
      clearTimeout,
      console,
    },
    { filename, timeout: TIMEOUT_MS },
  );
  return { exposed, subscribed };
}

/** The app view's preload: exposes `desktopBridge` with every function in `apis`. */
export function verifyAppPreload(source, apis) {
  const { exposed } = run(source, "preload.cjs");
  const bridge = exposed.get("desktopBridge");
  if (bridge === undefined) throw new Error("preload.cjs does not expose desktopBridge");
  const missing = apis.filter((api) => typeof bridge[api] !== "function");
  if (missing.length > 0) throw new Error(`desktopBridge is missing: ${missing.join(", ")}`);
}

/** The x.com preload: subscribes to every channel in `channels`. */
export function verifyOverlayPreload(source, channels) {
  const { subscribed } = run(source, "overlayPreload.cjs");
  const missing = channels.filter((channel) => !subscribed.has(channel));
  if (missing.length > 0) {
    throw new Error(`overlayPreload.cjs does not listen on: ${missing.join(", ")}`);
  }
}

/** Function members of the DesktopBridge interface, read from the web app's declaration. */
export const bridgeApis = (declaration) => {
  const body = declaration.slice(declaration.indexOf("interface DesktopBridge"));
  return [...body.matchAll(/^ {2}readonly (\w+): \(/gm)].map((m) => m[1]);
};

/** Channels main sends to the x.com preload: the OVERLAY_* constants under channels.ts's "Main -> overlay preload" comment. */
export const overlayChannels = (channelsSource) => {
  const start = channelsSource.indexOf("// Main -> overlay preload");
  const end = channelsSource.indexOf("// Overlay preload -> main", start);
  if (start === -1 || end === -1)
    throw new Error("channels.ts lost its overlay direction comments");
  return [
    ...channelsSource.slice(start, end).matchAll(/export const OVERLAY_\w+_CHANNEL = "([^"]+)"/g),
  ].map((m) => m[1]);
};

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  const read = (path) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");
  verifyAppPreload(
    read("../dist-electron/preload.cjs"),
    bridgeApis(read("../../web/src/desktopBridge.ts")),
  );
  verifyOverlayPreload(
    read("../dist-electron/overlayPreload.cjs"),
    overlayChannels(read("../src/ipc/channels.ts")),
  );
  console.log("Preload bundles verified.");
}
