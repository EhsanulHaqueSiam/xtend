import * as fs from "node:fs";
import * as path from "node:path";

import { isXSkinToggle, X_SKIN_DEFAULTS, type XSkinToggle } from "@xtend/contracts";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import * as Schema from "effect/Schema";

import {
  APP_ROUTE_CHANNEL,
  BRIDGE_INFO_CHANNEL,
  type BridgeInfo,
  GLANCE_CHANNEL,
  type Glance,
  OPEN_EXTERNAL_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_GLANCE_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  OVERLAY_VIEWER_CHANNEL,
  type OverlayAction,
  SESSION_DOWNLOAD_CHANNEL,
  type SessionDownload,
  SHORTCUT_CHANNEL,
  X_SKIN_CHANNEL,
} from "../ipc/channels.ts";
import { createOverlayFeed } from "../overlay/OverlayFeed.ts";
import { xSkinCss } from "../overlay/xSkin.ts";
import { attachDesktopCommands } from "../service/DesktopCommands.ts";
import { attachSessionCapture } from "../xSession/SessionCapture.ts";
import {
  browserUserAgent,
  externalWebUrl,
  guestKey,
  hardenXWebview,
  hostOf,
  isXHost,
  OAUTH_HOSTS,
  sessionPartition,
  X_HOME,
} from "./guestPolicy.ts";

const ZOOM_STEP = 0.5;
/** A renderer that dies again this soon after a reload stays down rather than reloading in a loop. */
const CRASH_RELOAD_MS = 10_000;

/** A dead renderer leaves the app or x.com black until a restart; bring it back once. */
const reloadWhenGone = (
  name: string,
  target: Electron.WebContents,
  log: (message: string, detail?: unknown) => void,
) => {
  let lastReload = 0;
  target.on("render-process-gone", (_event, details) => {
    log(`${name} renderer gone`, details.reason);
    if (details.reason === "clean-exit" || target.isDestroyed()) return;
    if (Date.now() - lastReload < CRASH_RELOAD_MS) return;
    lastReload = Date.now();
    target.reload();
  });
};

export interface MainWindowOptions {
  readonly appUrl: string;
  readonly serviceUrl: string;
  readonly serviceToken: string;
  /** Which account's x.com session the webview opens; one cookie partition per account. */
  readonly accountId: number;
  /** What the app page learns about its service through the preload. */
  readonly bridgeInfo: Omit<BridgeInfo, "xPartition" | "xStartUrl" | "initialRoute">;
  /** Where unacknowledged observation batches wait for the service. */
  readonly queueDir: string;
  /** The last x.com URL, restored on launch. */
  readonly sessionUrlFile: string;
  /** One-time cookie import: a JSON array of {name, value, domain} written by the user; deleted after import. */
  readonly importCookiesPath?: string | undefined;
  readonly log: (message: string, detail?: unknown) => void;
}

const CookieFile = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      value: Schema.String,
      domain: Schema.NonEmptyString,
    }),
  ),
);
const decodeCookieFile = Schema.decodeUnknownResult(CookieFile);

/**
 * Seeds the X session from cookies exported out of another browser, so the
 * user does not have to sign in twice. The file is removed before anything
 * is set, so a failure half-way never leaves the session token on disk.
 */
async function importCookies(
  xSession: Electron.Session,
  file: string,
  log: MainWindowOptions["log"],
): Promise<void> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    log("cookie import unreadable", String(error));
    return;
  } finally {
    fs.rmSync(file, { force: true });
  }
  const decoded = decodeCookieFile(text);
  if (decoded._tag === "Failure") {
    log("cookie import rejected", String(decoded.failure));
    return;
  }
  let count = 0;
  for (const cookie of decoded.success) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one at a time so a rejected cookie is logged by name.
      await xSession.cookies.set({
        url: `https://${cookie.domain.replace(/^\./, "")}/`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: "/",
        secure: true,
        httpOnly: cookie.name === "auth_token",
        sameSite: "no_restriction",
        expirationDate: Date.now() / 1000 + 365 * 86400,
      });
      count++;
    } catch (error) {
      log("cookie import skipped one", { name: cookie.name, error: String(error) });
    }
  }
  log("cookie import done", { count });
}

/**
 * x.com may ask for notifications; nothing else (camera, geolocation, clipboard reads) has a reason to.
 * Granted web notifications are shown by the OS notification centre; Electron does that itself.
 */
const allowNotificationsOnly = (s: Electron.Session) => {
  s.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "notifications"),
  );
  s.setPermissionCheckHandler((_contents, permission) => permission === "notifications");
};

const openExternalWeb = (url: string) => {
  const safe = externalWebUrl(url);
  if (safe !== null) void shell.openExternal(safe);
};

/** Spellcheck in the languages the OS is set to; macOS picks them itself and ignores this. */
const useSystemSpellcheckLanguages = (s: Electron.Session) => {
  if (process.platform === "darwin") return;
  const available = new Set(s.availableSpellCheckerLanguages);
  const preferred = app.getPreferredSystemLanguages().filter((l) => available.has(l));
  if (preferred.length > 0) s.setSpellCheckerLanguages(preferred);
};

/**
 * The window is the Xtend app. x.com is one `<webview>` inside it, on the
 * account's cookie partition: the user's own logged-in browser session, so
 * browsing costs nothing and looks like Chromium to X. The app page asks for
 * the webview; main gates it (only x.com, only this partition, only our
 * preload) and wires it up when it attaches: identity, skin, capture,
 * shortcuts, menus and downloads. Returns the window plus `openRoute`, so deep
 * links can land on a screen.
 */
export function createMainWindow(options: MainWindowOptions) {
  const partition = sessionPartition(options.accountId);
  const xSession = session.fromPartition(partition);
  allowNotificationsOnly(xSession);
  useSystemSpellcheckLanguages(xSession);

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#000000",
    title: "Xtend",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  });
  const appContents = window.webContents;
  allowNotificationsOnly(appContents.session);
  appContents.on("page-title-updated", (event) => event.preventDefault());
  reloadWhenGone("app", appContents, options.log);
  const toApp = (channel: string, value: unknown) => {
    if (!appContents.isDestroyed()) appContents.send(channel, value);
  };

  let startUrl = X_HOME;
  try {
    const saved = fs.readFileSync(options.sessionUrlFile, "utf8").trim();
    if (isXHost(saved)) startUrl = saved;
  } catch {}

  // A route asked for before the page has its bridge (a deep link at launch) rides in the bridge info.
  let bridgeServed = false;
  let pendingRoute: string | null = null;
  // Answer the preload's synchronous bridge-info request, and only for the app page.
  const onBridgeInfo = (event: Electron.IpcMainEvent) => {
    if (event.sender !== appContents) return;
    event.returnValue = {
      ...options.bridgeInfo,
      xPartition: partition,
      xStartUrl: startUrl,
      initialRoute: pendingRoute,
    } satisfies BridgeInfo;
    bridgeServed = true;
    pendingRoute = null;
  };
  ipcMain.on(BRIDGE_INFO_CHANNEL, onBridgeInfo);

  // The app renderer is ours, but a `_blank` link in it must not open a window carrying the preload.
  const appOrigin = new URL(options.appUrl).origin;
  appContents.setWindowOpenHandler(({ url }) => {
    openExternalWeb(url);
    return { action: "deny" };
  });
  appContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === appOrigin) return;
    event.preventDefault();
    openExternalWeb(url);
  });

  // Main decides what the app's webview becomes, whatever the page asked for.
  const overlayPreload = path.join(import.meta.dirname, "overlayPreload.cjs");
  appContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (hardenXWebview(webPreferences, params, { partition, preload: overlayPreload })) return;
    event.preventDefault();
    options.log("refused a webview", { src: params.src, partition: params.partition });
  });

  const onDownload = (_event: Electron.Event, item: Electron.DownloadItem) => {
    const downloads = app.getPath("downloads");
    let name = item.getFilename();
    for (let n = 1; fs.existsSync(path.join(downloads, name)); n++) {
      const ext = path.extname(item.getFilename());
      name = `${path.basename(item.getFilename(), ext)} (${n})${ext}`;
    }
    item.setSavePath(path.join(downloads, name));
    const report = (state: SessionDownload["state"]) =>
      toApp(SESSION_DOWNLOAD_CHANNEL, { name, state } satisfies SessionDownload);
    report("started");
    item.once("done", (_e, state) => report(state === "completed" ? "completed" : "failed"));
  };
  // The partition's session outlives the window (an account switch rebuilds it), so the listener goes with the window.
  xSession.on("will-download", onDownload);

  let glance: Glance | null = null;
  let skin: ReadonlyArray<XSkinToggle> = X_SKIN_DEFAULTS;
  let guest: { readonly contents: Electron.WebContents; readonly detach: () => void } | null = null;

  /** Everything x.com's webview needs, attached once per guest; returns the teardown. */
  const attachX = (contents: Electron.WebContents) => {
    contents.setUserAgent(browserUserAgent(contents.getUserAgent()));
    reloadWhenGone("x.com", contents, options.log);

    // The skin is CSS only and goes in on every full load; the key lets the app switch it off.
    let skinKey: string | null = null;
    const applySkin = async () => {
      if (skinKey !== null) await contents.removeInsertedCSS(skinKey).catch(() => {});
      skinKey = await contents.insertCSS(xSkinCss(skin), { cssOrigin: "user" });
    };
    contents.on("dom-ready", () => void applySkin());

    // Stay on X inside the app; sign-in providers get a popup on the same partition; everything else goes to the default browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (OAUTH_HOSTS.has(hostOf(url))) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            parent: window,
            webPreferences: { partition, contextIsolation: true, sandbox: true },
          },
        };
      }
      if (isXHost(url)) void contents.loadURL(url);
      else openExternalWeb(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isXHost(url)) return;
      event.preventDefault();
      openExternalWeb(url);
    });

    const onUrlChange = () => {
      overlay.navigated();
      try {
        fs.writeFileSync(options.sessionUrlFile, contents.getURL());
      } catch (error) {
        options.log("could not save session url", String(error));
      }
    };
    contents.on("did-navigate", onUrlChange);
    contents.on("did-navigate-in-page", onUrlChange);
    // A full load starts a fresh preload that has not seen the app's last glance.
    contents.on("did-finish-load", () => {
      if (glance !== null) contents.send(OVERLAY_GLANCE_CHANNEL, glance);
    });

    contents.on("context-menu", (_event, params) => {
      const items: Array<MenuItemConstructorOptions> = [];
      for (const suggestion of params.dictionarySuggestions) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (params.misspelledWord !== "") items.push({ type: "separator" });
      if (params.linkURL !== "") {
        items.push(
          { label: "Copy link", click: () => clipboard.writeText(params.linkURL) },
          { label: "Open link in browser", click: () => openExternalWeb(params.linkURL) },
        );
      }
      if (params.selectionText.trim() !== "") items.push({ label: "Copy text", role: "copy" });
      if (params.mediaType === "image") {
        items.push(
          { label: "Copy image", click: () => contents.copyImageAt(params.x, params.y) },
          { label: "Save image", click: () => contents.downloadURL(params.srcURL) },
        );
      }
      if (params.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" });
      if (items.length > 0 && items.at(-1)?.type !== "separator") items.push({ type: "separator" });
      items.push({ label: "Open page in browser", click: () => openExternalWeb(params.pageURL) });
      if (!app.isPackaged) {
        items.push({ label: "Inspect", click: () => contents.inspectElement(params.x, params.y) });
      }
      Menu.buildFromTemplate(items).popup({ window });
    });

    // Focus inside x.com keeps key events from the app page, so main hands it the app's chords.
    contents.on("before-input-event", (event, input) => {
      const key = guestKey(input, process.platform);
      if (key === null) return;
      event.preventDefault();
      if (key.kind === "app") return toApp(SHORTCUT_CHANNEL, key.key);
      if (key.kind === "overlayToggle") return contents.send(OVERLAY_TOGGLE_CHANNEL);
      if (key.kind === "history") {
        if (key.direction === "back") contents.navigationHistory.goBack();
        else contents.navigationHistory.goForward();
        return;
      }
      contents.setZoomLevel(key.step === 0 ? 0 : contents.getZoomLevel() + key.step * ZOOM_STEP);
    });

    const overlay = createOverlayFeed(contents);
    const createdListeners = new Set<(postId: string) => void>();
    let navViewer: string | null = null;
    const commands = attachDesktopCommands(contents, {
      serviceUrl: options.serviceUrl,
      serviceToken: options.serviceToken,
      navigate: (url) => {
        if (isXHost(url)) void contents.loadURL(url);
      },
      nextCreatedPost: () => new Promise((resolve) => createdListeners.add(resolve)),
      log: options.log,
    });
    const detachCapture = attachSessionCapture(contents, {
      serviceUrl: options.serviceUrl,
      serviceToken: options.serviceToken,
      accountId: options.accountId,
      queueDir: options.queueDir,
      log: options.log,
      onPosts: (batch, viewer) => {
        overlay.observe(batch, viewer);
        commands.marks(batch.map((p) => ({ postId: p.postId, handle: p.author.handle })));
      },
      onCreatedPost: (postId) => {
        for (const listener of createdListeners) listener(postId);
        createdListeners.clear();
      },
      fallbackViewer: () => navViewer,
    });

    const onAction = (event: Electron.IpcMainEvent, action: OverlayAction) => {
      if (event.sender !== contents) return;
      // The preload is ours, but x.com's page shares its process: only app paths get through.
      if (action.type === "openRoute") {
        if (typeof action.route === "string" && action.route.startsWith("/"))
          toApp(APP_ROUTE_CHANNEL, action.route);
        return;
      }
      const post = overlay.get(action.postId);
      if (post === undefined) return;
      commands.save({
        postId: post.postId,
        url: `https://x.com/${post.author.handle}/status/${post.postId}`,
        text: post.text,
        createdAt: post.createdAt,
        lang: null,
        isReply: post.isReply,
        isRepost: post.isRepost,
        hasMedia: post.hasMedia,
        hasLink: post.hasLink,
        author: { ...post.author, avatarUrl: null },
        metrics: post.metrics,
      });
    };
    ipcMain.on(OVERLAY_ACTION_CHANNEL, onAction);
    const onViewer = (event: Electron.IpcMainEvent, handle: unknown) => {
      if (
        event.sender === contents &&
        typeof handle === "string" &&
        /^[a-z0-9_]{1,15}$/.test(handle)
      )
        navViewer = handle;
    };
    ipcMain.on(OVERLAY_VIEWER_CHANNEL, onViewer);

    return {
      applySkin,
      detach: () => {
        ipcMain.off(OVERLAY_ACTION_CHANNEL, onAction);
        ipcMain.off(OVERLAY_VIEWER_CHANNEL, onViewer);
        detachCapture();
        commands.detach();
      },
    };
  };

  let applyGuestSkin: () => Promise<void> = async () => {};
  appContents.on("did-attach-webview", (_event, contents) => {
    guest?.detach();
    const attached = attachX(contents);
    applyGuestSkin = attached.applySkin;
    guest = { contents, detach: attached.detach };
    contents.once("destroyed", () => {
      if (guest?.contents !== contents) return;
      guest.detach();
      guest = null;
    });
  });

  // IPC from the app page; each handler checks its sender.
  const from = <T>(channel: string, handler: (value: T) => void) => {
    const listener = (event: Electron.IpcMainEvent, value: T) => {
      if (event.sender === appContents) handler(value);
    };
    ipcMain.on(channel, listener);
    return () => ipcMain.off(channel, listener);
  };
  const offIpc = [
    from<string>(OPEN_EXTERNAL_CHANNEL, openExternalWeb),
    from<Glance>(GLANCE_CHANNEL, (value) => {
      glance = value;
      guest?.contents.send(OVERLAY_GLANCE_CHANNEL, glance);
    }),
    from<unknown>(X_SKIN_CHANNEL, (value) => {
      if (!Array.isArray(value)) return;
      const next = value.filter(isXSkinToggle);
      if (next.join() === skin.join()) return;
      skin = next;
      void applyGuestSkin();
    }),
  ];

  window.on("closed", () => {
    ipcMain.off(BRIDGE_INFO_CHANNEL, onBridgeInfo);
    for (const off of offIpc) off();
    xSession.off("will-download", onDownload);
    guest?.detach();
    guest = null;
  });

  const importPath = options.importCookiesPath;
  void (
    importPath === undefined ? Promise.resolve() : importCookies(xSession, importPath, options.log)
  ).then(() => appContents.loadURL(options.appUrl));

  return {
    window,
    /** The app page's contents: main's own IPC handlers answer only it. */
    appContents,
    /** Shows an app route; a tool route keeps x.com in the side panel. */
    openRoute: (route: string) => {
      if (bridgeServed) toApp(APP_ROUTE_CHANNEL, route);
      else pendingRoute = route;
    },
    /** Dev only: the whole window, x.com webview included. */
    capture: () => window.webContents.capturePage(),
  };
}
