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
} from "electron";
import * as Schema from "effect/Schema";

import {
  BRIDGE_INFO_CHANNEL,
  type BridgeInfo,
  COLUMN_RECT_CHANNEL,
  EDITING_CHANNEL,
  GLANCE_CHANNEL,
  type Glance,
  OVERLAY_GLANCE_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OVERLAY_ACTION_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  POINTER_DOWN_CHANNEL,
  type Rect,
  SESSION_DOWNLOAD_CHANNEL,
  SESSION_FIND_CHANNEL,
  SESSION_FIND_RESULT_CHANNEL,
  SESSION_NAVIGATE_CHANNEL,
  SESSION_URL_CHANNEL,
  SHORTCUT_CHANNEL,
  SLOT_CHANNEL,
  SLOT_CLOSE_CHANNEL,
  SLOT_OPEN_CHANNEL,
  type OverlayAction,
  type SessionDownload,
  type SessionFind,
  type ShortcutKey,
  type SlotClose,
  type SlotOpen,
  type SlotState,
} from "../ipc/channels.ts";
import { createOverlayFeed } from "../overlay/OverlayFeed.ts";
import { BANNER_INSET_CSS } from "../overlay/xDom.ts";
import { attachDesktopCommands } from "../service/DesktopCommands.ts";
import { attachSessionCapture } from "../xSession/SessionCapture.ts";
import { close, dismiss, EMPTY, slotBounds } from "./Slots.ts";

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
const X_HOME = "https://x.com/home";
/** Sign-in providers x.com opens in a popup; they share the session partition so the cookie lands in it. */
const OAUTH_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);
/** Account 1 keeps the partition name from before multi-account, so an existing login survives the upgrade. */
const sessionPartition = (accountId: number) =>
  accountId === 1 ? "persist:x-session" : `persist:x-session-${accountId}`;
const ZOOM_STEP = 0.5;

export interface MainWindowOptions {
  readonly appUrl: string;
  readonly serviceUrl: string;
  readonly serviceToken: string;
  /** Which account's x.com session the window opens; one cookie partition per account. */
  readonly accountId: number;
  /** What the app page learns about its service through the preload. */
  readonly bridgeInfo: Omit<BridgeInfo, "slot">;
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

const isRect = (value: unknown): value is Rect =>
  typeof value === "object" &&
  value !== null &&
  ["x", "y", "width", "height"].every(
    (k) => typeof (value as Record<string, unknown>)[k] === "number",
  );

const SLOT_KINDS = new Set(["center", "popover", "sheet", "palette", "bar", "toast"]);
const isSlotKind = (value: unknown): value is SlotOpen["kind"] =>
  typeof value === "string" && SLOT_KINDS.has(value);
const isSlotOpen = (value: unknown): value is SlotOpen => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isSlotKind(v.kind) &&
    typeof v.route === "string" &&
    v.route.startsWith("/") &&
    (v.anchor === undefined || isRect(v.anchor))
  );
};

/** The slot a key press opens; palette and the bars toggle, so the same key closes them again. */
const SLOT_FOR_KEY: Record<Exclude<ShortcutKey, "overlayToggle">, SlotOpen> = {
  palette: { kind: "palette", route: "/palette" },
  compose: { kind: "center", route: "/compose" },
  plan: { kind: "center", route: "/plan" },
  analyze: { kind: "center", route: "/analyze" },
  engage: { kind: "center", route: "/engage" },
  library: { kind: "center", route: "/library" },
  find: { kind: "bar", route: "/bar/find" },
  address: { kind: "bar", route: "/bar/address" },
};

/** The app shortcut a key press stands for, if any. Single letters only count outside text fields. */
function shortcutFor(input: Electron.Input, editing: boolean): ShortcutKey | undefined {
  if (input.type !== "keyDown" || input.isAutoRepeat) return undefined;
  const mod = process.platform === "darwin" ? input.meta : input.control;
  if (mod && !input.shift && !input.alt) {
    if (input.code === "KeyK") return "palette";
    if (input.code === "KeyF") return "find";
    if (input.code === "KeyL") return "address";
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

/**
 * x.com is the window itself; the React app lives in one child view that
 * main moves between slots over it. Returns the window plus `openSlot`, so
 * deep links can land on a screen.
 */
export function createMainWindow(options: MainWindowOptions) {
  const partition = sessionPartition(options.accountId);
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
      partition,
      preload: path.join(import.meta.dirname, "overlayPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const contents = window.webContents;
  allowNotificationsOnly(contents.session);
  useSystemSpellcheckLanguages(contents.session);
  contents.setUserAgent(browserUserAgent(contents.getUserAgent()));
  contents.on("page-title-updated", (event) => event.preventDefault());
  if (process.platform === "darwin") {
    contents.on("dom-ready", () => void contents.insertCSS(BANNER_INSET_CSS));
  }

  // The app view is transparent: popover, sheet and toast pages draw their own frame and shadow.
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const appContents = view.webContents;
  view.setBackgroundColor("#00000000");
  view.setBounds(EMPTY);
  window.contentView.addChildView(view);
  allowNotificationsOnly(appContents.session);

  // Slot state. The view is never destroyed: hidden means empty bounds, so its socket and atoms stay warm.
  let current: SlotOpen | null = null;
  let lastRoute = "/";
  let column: Rect | null = null;
  const slotState = (): SlotState => ({ kind: current?.kind ?? null, route: lastRoute });
  const toApp = (channel: string, value: unknown) => {
    if (!appContents.isDestroyed()) appContents.send(channel, value);
  };
  const applyBounds = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds(current === null ? EMPTY : slotBounds(current, { width, height }, column));
  };
  const setSlot = (next: SlotOpen | null) => {
    if (next === current) return;
    current = next;
    if (next !== null) lastRoute = next.route;
    applyBounds();
    toApp(SLOT_CHANNEL, slotState());
    if (next === null) return contents.focus();
    // The address bar prefills from this; the app may have missed the navigation while hidden.
    toApp(SESSION_URL_CHANNEL, contents.getURL());
    appContents.focus();
  };
  window.on("resize", applyBounds);

  // Answer the preload's synchronous bridge-info request, and only for this view.
  const onBridgeInfo = (event: Electron.IpcMainEvent) => {
    if (event.sender === appContents)
      event.returnValue = { ...options.bridgeInfo, slot: slotState() } satisfies BridgeInfo;
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
  // A full load starts a fresh preload that has not seen the app's last glance.
  let glance: Glance | null = null;
  contents.on("did-finish-load", () => {
    if (glance !== null) contents.send(OVERLAY_GLANCE_CHANNEL, glance);
  });
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

  // Shortcuts: main turns them into slots itself, and tells the app which key it was.
  const editing = new WeakMap<Electron.WebContents, boolean>();
  const handleShortcut = (key: ShortcutKey) => {
    toApp(SHORTCUT_CHANNEL, key);
    if (key === "overlayToggle") return contents.send(OVERLAY_TOGGLE_CHANNEL);
    const slot = SLOT_FOR_KEY[key];
    setSlot(key === "palette" && current?.kind === "palette" ? null : slot);
  };
  contents.on("before-input-event", (event, input) => {
    const key = shortcutFor(input, editing.get(contents) === true);
    if (key !== undefined) {
      event.preventDefault();
      return handleShortcut(key);
    }
    if (input.type !== "keyDown") return;
    if (input.key === "Escape" && current !== null && current.kind !== "toast") {
      event.preventDefault();
      return setSlot(dismiss(current));
    }
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (!mod || input.alt) return;
    const zoom = contents.getZoomLevel();
    if (input.key === "=" || input.key === "+") contents.setZoomLevel(zoom + ZOOM_STEP);
    else if (input.key === "-") contents.setZoomLevel(zoom - ZOOM_STEP);
    else if (input.key === "0") contents.setZoomLevel(0);
    else if (input.key === "[") contents.navigationHistory.goBack();
    else if (input.key === "]") contents.navigationHistory.goForward();
    else return;
    event.preventDefault();
  });
  // The app's own DOM handles its letters, ⌘K and Esc; only the keys it cannot act on come through here.
  appContents.on("before-input-event", (event, input) => {
    const key = shortcutFor(input, true);
    if (key !== "find" && key !== "address" && key !== "overlayToggle") return;
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
  const commands = attachDesktopCommands(contents, {
    serviceUrl: options.serviceUrl,
    serviceToken: options.serviceToken,
    navigate: navigateSession,
    nextCreatedPost: () => new Promise((resolve) => createdListeners.add(resolve)),
    log: options.log,
  });

  // IPC from the app view and the x.com preload; each handler checks its sender.
  const from = <T>(sender: Electron.WebContents, channel: string, handler: (value: T) => void) => {
    const listener = (event: Electron.IpcMainEvent, value: T) => {
      if (event.sender === sender) handler(value);
    };
    ipcMain.on(channel, listener);
    return () => ipcMain.off(channel, listener);
  };
  const offIpc = [
    from<unknown>(appContents, SLOT_OPEN_CHANNEL, (value) => {
      if (isSlotOpen(value)) setSlot(value);
    }),
    from<SlotClose | undefined>(appContents, SLOT_CLOSE_CHANNEL, (value) => {
      const kind = value?.kind;
      setSlot(close(current, isSlotKind(kind) ? kind : undefined));
    }),
    from<unknown>(appContents, SESSION_NAVIGATE_CHANNEL, (url) => {
      if (typeof url === "string") navigateSession(url);
    }),
    from<SessionFind>(appContents, SESSION_FIND_CHANNEL, (find) => {
      if (find === null || find.text === "") contents.stopFindInPage("clearSelection");
      else contents.findInPage(find.text, { forward: find.forward, findNext: find.findNext });
    }),
    from<string>(appContents, OPEN_EXTERNAL_CHANNEL, openExternalWeb),
    from<boolean>(appContents, EDITING_CHANNEL, (v) => editing.set(appContents, v === true)),
    from<Glance>(appContents, GLANCE_CHANNEL, (value) => {
      glance = value;
      contents.send(OVERLAY_GLANCE_CHANNEL, glance);
    }),
    from<boolean>(contents, EDITING_CHANNEL, (v) => editing.set(contents, v === true)),
    from<unknown>(contents, COLUMN_RECT_CHANNEL, (value) => {
      // The preload measures in x.com CSS pixels; the window's are those times the zoom.
      const zoom = contents.getZoomFactor();
      column = isRect(value)
        ? {
            x: value.x * zoom,
            y: value.y * zoom,
            width: value.width * zoom,
            height: value.height * zoom,
          }
        : null;
      applyBounds();
    }),
    from<undefined>(contents, POINTER_DOWN_CHANNEL, () => setSlot(dismiss(current))),
    from<OverlayAction>(contents, OVERLAY_ACTION_CHANNEL, (action) => {
      if (action.type === "openSlot") return setSlot(action.slot);
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
    ipcMain.off(BRIDGE_INFO_CHANNEL, onBridgeInfo);
    for (const off of offIpc) off();
    detachCapture();
    commands.detach();
    appContents.close();
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
  void appContents.loadURL(options.appUrl);

  return {
    window,
    openSlot: (slot: SlotOpen) => setSlot(slot),
    /** Dev only: x.com and the slot view as separate images (a window capture omits child views) plus where the slot sits. */
    capture: async () => ({
      x: await window.capturePage(),
      slot: current === null ? null : await appContents.capturePage(),
      bounds: view.getBounds(),
    }),
  };
}
