import * as fs from "node:fs";
import * as path from "node:path";

import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
  type MenuItemConstructorOptions,
  type Rectangle,
} from "electron";
import * as Schema from "effect/Schema";

import {
  EDITING_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_ROUTE_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  SESSION_DOWNLOAD_CHANNEL,
  SESSION_FIND_CHANNEL,
  SESSION_FIND_RESULT_CHANNEL,
  SESSION_NAVIGATE_CHANNEL,
  SESSION_URL_CHANNEL,
  SESSION_VIEW_BOUNDS_CHANNEL,
  SESSION_VIEW_HIDDEN_CHANNEL,
  SHORTCUT_CHANNEL,
  type OverlayAction,
  type SessionDownload,
  type SessionFind,
  type SessionNavigation,
  type ShortcutKey,
} from "../ipc/channels.ts";
import { createOverlayFeed } from "../overlay/OverlayFeed.ts";
import { attachDesktopCommands } from "../service/DesktopCommands.ts";
import { attachSessionCapture } from "../xSession/SessionCapture.ts";

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
const X_HOME = "https://x.com/home";
/** Sign-in providers x.com opens in a popup; they share the session partition so the cookie lands in it. */
const OAUTH_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);
const SESSION_PARTITION = "persist:x-session";
const ZOOM_STEP = 0.5;
/** One rule hides X's left rail; the primary column keeps its own width. */
const HIDE_RAIL_CSS = 'header[role="banner"] { display: none !important; }';

export interface MainWindowOptions {
  readonly appUrl: string;
  readonly serviceUrl: string;
  readonly serviceToken: string;
  /** Where unacknowledged observation batches wait for the service. */
  readonly queueDir: string;
  /** The last session URL, restored on launch. */
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
  session: Electron.Session,
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
      await session.cookies.set({
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
const allowNotificationsOnly = (session: Electron.Session) => {
  session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "notifications"),
  );
  session.setPermissionCheckHandler((_contents, permission) => permission === "notifications");
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
const isXHost = (url: string) => X_HOSTS.has(hostOf(url));

/** Only web URLs leave the app; a page must not be able to launch file: or custom-scheme handlers. */
const openExternalWeb = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      void shell.openExternal(parsed.toString());
    }
  } catch {}
};

/** Chromium's UA minus the Electron and app tokens, so x.com serves its normal desktop site. */
const browserUserAgent = (ua: string) =>
  ua
    .replace(/ Electron\/\S+/, "")
    .replace(/ xtend\/\S+/i, "")
    .replace(/ @xtend\/\S+/i, "");

const isBounds = (value: unknown): value is Rectangle =>
  typeof value === "object" &&
  value !== null &&
  ["x", "y", "width", "height"].every(
    (k) => typeof (value as Record<string, unknown>)[k] === "number",
  );

const EMPTY: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

/** The app shortcut a key press stands for, if any. Single letters only count outside text fields. */
function shortcutFor(input: Electron.Input, editing: boolean): ShortcutKey | undefined {
  if (input.type !== "keyDown" || input.isAutoRepeat) return undefined;
  const mod = process.platform === "darwin" ? input.meta : input.control;
  if (mod && !input.shift && !input.alt) {
    if (input.code === "KeyK") return "palette";
    if (input.code === "KeyF") return "find";
    return undefined;
  }
  if (input.alt && !mod && !input.shift && input.code === "KeyO") return "overlayToggle";
  if (mod || input.alt || input.control || input.shift || editing) return undefined;
  switch (input.code) {
    case "KeyC":
      return "compose";
    case "KeyP":
      return "plan";
    case "KeyA":
      return "analyze";
    case "KeyE":
      return "engage";
    case "KeyL":
      return "library";
    default:
      return undefined;
  }
}

/** Spellcheck in the languages the OS is set to; macOS picks them itself and ignores this. */
const useSystemSpellcheckLanguages = (session: Electron.Session) => {
  if (process.platform === "darwin") return;
  const available = new Set(session.availableSpellCheckerLanguages);
  const preferred = app.getPreferredSystemLanguages().filter((l) => available.has(l));
  if (preferred.length > 0) session.setSpellCheckerLanguages(preferred);
};

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
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
    },
  });

  // The app renderer is ours, but a `_blank` link in it must not open a window carrying the preload.
  const appOrigin = new URL(options.appUrl).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWeb(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === appOrigin) return;
    event.preventDefault();
    openExternalWeb(url);
  });
  allowNotificationsOnly(window.webContents.session);

  // The session view is a sibling native view, not an iframe: X's frame-busting
  // never sees it, and its cookies live in their own persistent partition.
  const session = new WebContentsView({
    webPreferences: {
      partition: SESSION_PARTITION,
      preload: path.join(import.meta.dirname, "overlayPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const contents = session.webContents;
  allowNotificationsOnly(contents.session);
  useSystemSpellcheckLanguages(contents.session);
  session.setBackgroundColor("#000000");
  contents.setUserAgent(browserUserAgent(contents.getUserAgent()));
  session.setBounds(EMPTY);
  window.contentView.addChildView(session);

  // Stay on X inside the app; sign-in providers get a popup on the same partition; everything else goes to the default browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (OAUTH_HOSTS.has(hostOf(url))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          parent: window,
          webPreferences: { partition: SESSION_PARTITION, contextIsolation: true, sandbox: true },
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

  // Browser chrome the native view lacks: the app window draws the bar, main does the work.
  const toApp = (channel: string, value: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, value);
  };
  const navigateSession = (url: string) => {
    if (isXHost(url)) void contents.loadURL(url);
  };
  const onUrlChange = () => {
    const url = contents.getURL();
    toApp(SESSION_URL_CHANNEL, url);
    overlay.navigated();
    try {
      fs.writeFileSync(options.sessionUrlFile, url);
    } catch (error) {
      options.log("could not save session url", String(error));
    }
  };
  contents.on("did-navigate", onUrlChange);
  contents.on("did-navigate-in-page", onUrlChange);
  contents.on("found-in-page", (_event, result) =>
    toApp(SESSION_FIND_RESULT_CHANNEL, {
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
    }),
  );
  contents.session.on("will-download", (_event, item) => {
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

  // Shortcuts: whichever view has the key reports it; the app decides what it means.
  const editing = new WeakMap<Electron.WebContents, boolean>();
  const handleShortcut = (key: ShortcutKey) => {
    toApp(SHORTCUT_CHANNEL, key);
    if (key === "overlayToggle") contents.send(OVERLAY_TOGGLE_CHANNEL);
  };
  contents.on("before-input-event", (event, input) => {
    const key = shortcutFor(input, editing.get(contents) === true);
    if (key !== undefined) {
      event.preventDefault();
      return handleShortcut(key);
    }
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (input.type !== "keyDown" || !mod || input.alt) return;
    // Zoom, back and forward only ever apply to the x.com view, never the app.
    const zoom = contents.getZoomLevel();
    if (input.key === "=" || input.key === "+") contents.setZoomLevel(zoom + ZOOM_STEP);
    else if (input.key === "-") contents.setZoomLevel(zoom - ZOOM_STEP);
    else if (input.key === "0") contents.setZoomLevel(0);
    else if (input.key === "[") contents.navigationHistory.goBack();
    else if (input.key === "]") contents.navigationHistory.goForward();
    else return;
    event.preventDefault();
  });
  // The app's own DOM handles its letters and ⌘K; only the keys it cannot see come through here.
  window.webContents.on("before-input-event", (event, input) => {
    const key = shortcutFor(input, true);
    if (key !== "find" && key !== "overlayToggle") return;
    event.preventDefault();
    handleShortcut(key);
  });

  const overlay = createOverlayFeed(contents);
  const createdListeners = new Set<(postId: string) => void>();
  const detachCapture = attachSessionCapture(contents, {
    serviceUrl: options.serviceUrl,
    serviceToken: options.serviceToken,
    queueDir: options.queueDir,
    log: options.log,
    onPosts: overlay.observe,
    onCreatedPost: (postId) => {
      for (const listener of createdListeners) listener(postId);
      createdListeners.clear();
    },
  });
  let railHidden = false;
  const commands = attachDesktopCommands(contents, {
    serviceUrl: options.serviceUrl,
    serviceToken: options.serviceToken,
    navigate: navigateSession,
    nextCreatedPost: () => new Promise((resolve) => createdListeners.add(resolve)),
    onSettings: (settings) => {
      // The settings column is not in the contract yet; honour it once it is.
      const hide = "hideXRail" in settings && settings.hideXRail === true;
      if (hide === railHidden) return;
      railHidden = hide;
      if (hide) void contents.insertCSS(HIDE_RAIL_CSS);
      else void contents.removeInsertedCSS(HIDE_RAIL_CSS);
    },
    log: options.log,
  });

  // IPC from the app window and the overlay; each handler checks its sender.
  let bounds = EMPTY;
  let hidden = false;
  const applyBounds = () => session.setBounds(hidden ? EMPTY : bounds);
  const from = <T>(sender: Electron.WebContents, channel: string, handler: (value: T) => void) => {
    const listener = (event: Electron.IpcMainEvent, value: T) => {
      if (event.sender === sender) handler(value);
    };
    ipcMain.on(channel, listener);
    return () => ipcMain.off(channel, listener);
  };
  const appContents = window.webContents;
  const offIpc = [
    from<unknown>(appContents, SESSION_VIEW_BOUNDS_CHANNEL, (value) => {
      bounds = isBounds(value) ? value : EMPTY;
      applyBounds();
      // The slot mounts after the bar subscribed; this replays the URL the bar missed.
      if (isBounds(value)) toApp(SESSION_URL_CHANNEL, contents.getURL());
    }),
    from<boolean>(appContents, SESSION_VIEW_HIDDEN_CHANNEL, (value) => {
      hidden = value === true;
      applyBounds();
    }),
    from<SessionNavigation>(appContents, SESSION_NAVIGATE_CHANNEL, (nav) => {
      if (nav.action === "url") navigateSession(nav.url);
      else if (nav.action === "back") contents.navigationHistory.goBack();
      else if (nav.action === "forward") contents.navigationHistory.goForward();
      else contents.reload();
    }),
    from<SessionFind>(appContents, SESSION_FIND_CHANNEL, (find) => {
      if (find === null || find.text === "") contents.stopFindInPage("clearSelection");
      else contents.findInPage(find.text, { forward: find.forward, findNext: find.findNext });
    }),
    from<string>(appContents, OPEN_EXTERNAL_CHANNEL, openExternalWeb),
    from<boolean>(appContents, EDITING_CHANNEL, (v) => editing.set(appContents, v === true)),
    from<boolean>(contents, EDITING_CHANNEL, (v) => editing.set(contents, v === true)),
    from<OverlayAction>(contents, OVERLAY_ACTION_CHANNEL, (action) => {
      if (action.type === "openRoute") return toApp(OPEN_ROUTE_CHANNEL, action.href);
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
    }),
  ];

  window.on("closed", () => {
    for (const off of offIpc) off();
    detachCapture();
    commands.detach();
  });

  let startUrl = X_HOME;
  try {
    const saved = fs.readFileSync(options.sessionUrlFile, "utf8").trim();
    if (isXHost(saved)) startUrl = saved;
  } catch {}
  const importPath = options.importCookiesPath;
  void (
    importPath === undefined
      ? Promise.resolve()
      : importCookies(contents.session, importPath, options.log)
  ).then(() => contents.loadURL(startUrl));
  void window.loadURL(options.appUrl);
  return window;
}
