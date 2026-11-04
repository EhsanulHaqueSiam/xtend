import { Engage_METHODS, type EngineSpace } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";

import { clientRuntime, XtendClient } from "../rpc/client";
import { xGo, xKeepPage, xPressOver, xRun, xRunHeld } from "./x";

/**
 * X's Spaces in Xtend: the dock beside X's screens shows one Space, opened from its card. Opening
 * it reads X's answer for the Space and joins nothing; only the user's click on Start listening
 * makes them a listener, through X's own button on X's own page. X plays the audio in its page,
 * from its own dock, which X keeps across its routes; every control presses X's own.
 */

/** The Space the dock shows; null when it is closed. Kept across screens, as X keeps its dock. */
export const spaceDockAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);

/** X's word for where a Space is: live, scheduled, or over (with or without its recording). */
export const spacePhase = (space: Pick<EngineSpace, "state" | "recorded">) =>
  space.state === "Running"
    ? "live"
    : space.state === "NotStarted" || space.state === "PrePublished"
      ? "scheduled"
      : space.recorded
        ? "recorded"
        : "ended";

/**
 * The authors of the account's reply targets, read once per open dock: Engage's own list follows
 * every observation, which a Space beside the screen has no use for. Free (no refresh).
 */
export const spaceTargetsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    const targets = yield* client[Engage_METHODS.targets]({});
    return new Set(targets.map((t) => t.post.author.handle.toLowerCase()));
  }),
);

const Caption = Schema.Struct({ name: Schema.String, handle: Schema.String, text: Schema.String });
type Caption = typeof Caption.Type;

/** What X's own dock shows of the Space X plays; X draws it only once the user is in one. */
const SpaceDockRead = Schema.Struct({
  /** X's header button: Leave for a listener or speaker, End for the host, Close for a recording. */
  word: Schema.Literals(["Leave", "End", "Close"]),
  /** X's request button as it reads now: "Request to speak", "Request sent"; null when X draws none. */
  request: Schema.NullOr(Schema.String),
  /** X's mic, for a speaker: "Mute" while it is on, "Unmute" while off; null for a listener. */
  mic: Schema.NullOr(Schema.Literals(["Mute", "Unmute"])),
  react: Schema.Boolean,
  /** X's captions panel, the lines X shows in it; null while captions are off. */
  captions: Schema.NullOr(Schema.Array(Caption)),
  /** X's player for a recording: where it is and how long it runs (ms), from X's own times. */
  player: Schema.NullOr(
    Schema.Struct({
      at: Schema.Number,
      length: Schema.Number,
      playing: Schema.Boolean,
      /** X's speed button's label ("Speed 1.5x"). */
      speed: Schema.NullOr(Schema.String),
    }),
  ),
});
export type SpaceDockRead = typeof SpaceDockRead.Type;

/**
 * X's dock in X's page: the box under X's layout that holds its header's text button (Leave, End or
 * Close, no label) beside its Collapse. X draws it next to its main column, so the box is the
 * largest one around that button that does not hold the main column. Runs in X's page as source.
 */
function spaceDockRoot(
  doc: Document,
): { readonly box: Element; readonly word: "Leave" | "End" | "Close" } | null {
  for (const b of doc.querySelectorAll('[role="button"], button')) {
    const word = (b.textContent ?? "").trim();
    if (b.hasAttribute("aria-label") || (word !== "Leave" && word !== "End" && word !== "Close"))
      continue;
    let box: Element | null = b.parentElement;
    while (box !== null && box.querySelector('[aria-label="Collapse"]') === null)
      box = box.parentElement;
    if (box === null) continue;
    while (
      box.parentElement !== null &&
      box.parentElement.querySelector('main, [role="main"]') === null
    )
      box = box.parentElement;
    return { box, word };
  }
  return null;
}

/**
 * What X's dock draws now, by X's own labels; null when X draws no dock. Captions are X's panel's
 * lines, each X's name, @handle, then what they said. Runs in X's page as its own source.
 */
function readSpaceDock(doc: Document, root: typeof spaceDockRoot): SpaceDockRead | null {
  const dock = root(doc);
  if (dock === null) return null;
  const labelled = (...labels: ReadonlyArray<string>) =>
    labels.find((l) => dock.box.querySelector(`[aria-label="${l}"]`) !== null) ?? null;
  const panel = dock.box.querySelector('[role="listbox"]');
  const captions: Array<Caption> = [];
  if (panel instanceof HTMLElement) {
    const lines = panel.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i + 1]?.startsWith("@") === true) {
        captions.push({ name: lines[i]!, handle: lines[i + 1]!.slice(1), text: "" });
        i++;
      } else if (captions.length > 0) {
        const last = captions[captions.length - 1]!;
        captions[captions.length - 1] = {
          ...last,
          text: last.text === "" ? lines[i]! : `${last.text} ${lines[i]}`,
        };
      }
    }
  }
  const mic = labelled("Mute", "Unmute");
  // X's seek slider writes the time played, then the time left with a minus.
  const times = [...dock.box.querySelectorAll("*")].flatMap((e) => {
    const t = e.childElementCount === 0 ? (e.textContent ?? "").trim() : "";
    return /^-?\d{1,2}(:\d{2}){1,2}$/.test(t) ? [t] : [];
  });
  const ms = (t: string) =>
    t
      .replace("-", "")
      .split(":")
      .reduce((n, part) => n * 60 + Number(part), 0) * 1000;
  const played = times.find((t) => !t.startsWith("-"));
  const left = times.find((t) => t.startsWith("-"));
  const speed = dock.box.querySelector('[aria-label^="Speed "]');
  return {
    player:
      played === undefined || left === undefined
        ? null
        : {
            at: ms(played),
            length: ms(played) + ms(left),
            playing: labelled("Pause") !== null,
            speed: speed?.getAttribute("aria-label") ?? null,
          },
    word: dock.word,
    request: labelled("Request to speak", "Request sent", "Join as speaker"),
    mic: mic === "Mute" || mic === "Unmute" ? mic : null,
    react: labelled("React") !== null,
    captions: panel === null ? null : captions,
  };
}

/** X's dock as Xtend last read it, and the Space the user joined from Xtend (X's dock names none). */
export interface SpaceLive {
  readonly read: SpaceDockRead | null;
  readonly joined: string | null;
}
export const spaceLiveAtom = Atom.make<SpaceLive>({ read: null, joined: null }).pipe(
  Atom.keepAlive,
);

const decodeRead = Schema.decodeUnknownOption(
  Schema.Struct({ hash: Schema.String, read: Schema.NullOr(SpaceDockRead) }),
);
const READ = `(() => { const read = ${readSpaceDock.toString()}; const root = ${spaceDockRoot.toString()}; return () => read(document, root); })()`;

const decodeDock = Schema.decodeUnknownOption(Schema.NullOr(SpaceDockRead));

/** X's dock as X's page draws it now; null for none (or no engine). */
export const xSpaceDockNow = async () =>
  Option.getOrNull(decodeDock(await xRun(`${READ}()`))) ?? null;

/**
 * Reads X's dock into `onRead` until `signal` ends it, each time X redraws it: X's page watches
 * itself and answers once the dock reads differently, or after a while with what it has.
 */
export const watchSpaceDock = (signal: AbortSignal, onRead: (read: SpaceDockRead | null) => void) =>
  void (async () => {
    let last = "";
    while (!signal.aborted) {
      const answer = await xRunHeld(
        `(async () => {
        const read = ${READ};
        const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
        const look = () => { const r = read(); return { hash: hash(JSON.stringify(r)), read: r }; };
        const now = look();
        if (now.hash !== ${JSON.stringify(last)}) return now;
        return new Promise((done) => {
          let quiet;
          const finish = () => { observer.disconnect(); clearTimeout(quiet); clearTimeout(cap); done(look()); };
          // X redraws its page in bursts: one look once it settles.
          const observer = new MutationObserver(() => {
            clearTimeout(quiet);
            quiet = setTimeout(() => { if (look().hash !== ${JSON.stringify(last)}) finish(); }, 150);
          });
          observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-label"] });
          const cap = setTimeout(finish, 15000);
        });
      })()`,
        signal,
      );
      if (signal.aborted) return;
      const next = Option.getOrNull(decodeRead(answer));
      if (next === null) await new Promise((r) => setTimeout(r, 1000));
      else {
        last = next.hash;
        // A full load of X's page ends the Space X plays: while it plays, the engine moves only
        // through X's router.
        xKeepPage(next.read !== null);
        onRead(next.read);
      }
    }
  })();

// A Space id goes into scripts run in X's page.
const validSpace = (id: string) => /^[A-Za-z0-9]{8,20}$/.test(id);
const peekUrl = (id: string) => `https://x.com/i/spaces/${id}/peek`;
const ON_PEEK = (id: string) => `location.pathname === ${JSON.stringify(`/i/spaces/${id}/peek`)}`;

/**
 * Opens X's own page for Space `spaceId` so X answers for it (AudioSpaceById), then goes Back to
 * where the engine was. X's page joins nothing there: only its Start listening does.
 */
export const xSpaceRead = async (spaceId: string) => {
  if (!validSpace(spaceId) || !(await xGo(peekUrl(spaceId)))) return;
  await xRun(`(async () => {
    for (let i = 0; i < 40 && ${ON_PEEK(spaceId)} && !document.querySelector('[aria-label="Start listening"], [aria-label="Play recording"], [aria-label="Set reminder"]'); i++)
      await new Promise((r) => setTimeout(r, 150));
    if (${ON_PEEK(spaceId)}) history.back();
    return true;
  })()`);
};

/**
 * Presses X's own Start listening on Space `spaceId`'s page for the user's click: the user joins as
 * a listener, in public, as on X. Then the engine goes Back where it was; X's dock stays and plays.
 * True once X drew its dock; null when X offered no Start listening there (X's page says why).
 */
export const xSpaceListen = (spaceId: string) => pressOnPage(spaceId, "Start listening");

/**
 * Presses X's own Play recording on Space `spaceId`'s page for the user's click: X's player for the
 * recording takes X's dock. True once X drew it; null when X offered no recording there.
 */
export const xSpacePlay = (spaceId: string) => pressOnPage(spaceId, "Play recording");

const pressOnPage = async (spaceId: string, label: "Start listening" | "Play recording") => {
  if (!validSpace(spaceId)) return null;
  const moved = await xGo(peekUrl(spaceId));
  const answer = await xPressOver(
    (mine) => `(async () => {
    const root = ${spaceDockRoot.toString()};
    const find = () => document.querySelector(${JSON.stringify(`[role="button"][aria-label="${label}"], button[aria-label="${label}"]`)});
    for (let i = 0; i < 50 && ${ON_PEEK(spaceId)} && !find(); i++) await new Promise((r) => setTimeout(r, 100));
    const button = find();
    if (!button || !(${ON_PEEK(spaceId)}) || !${mine}) return null;
    button.click();
    for (let i = 0; i < 50 && !root(document); i++) await new Promise((r) => setTimeout(r, 100));
    return root(document) ? "joined" : null;
  })()`,
    "false",
    () => {},
  );
  // X closes its page as it joins; one still up (it refused) goes, back to where the engine was.
  if (moved) await xRun(`${ON_PEEK(spaceId)} && history.back(), true`);
  return answer === "joined" ? true : null;
};

/** Takes the engine off Space `spaceId`'s page, where X goes once its host ended it. */
export const xSpaceLeavePage = (spaceId: string) =>
  validSpace(spaceId) ? xRun(`${ON_PEEK(spaceId)} && history.back(), true`) : Promise.resolve(null);

/** X's own dialogs and sheets, which X draws over its page until the user answers them. */
const ASKING = `!!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')`;

/**
 * Presses the control labelled `label` in X's dock for the user's click, only while X's dock
 * draws it so (X may have turned it since): Leave, End, Request to speak and Request sent (which
 * cancels), Mute, Unmute, Share. What X asks next (End's confirm, Share's sheet) shows over the
 * main area until the user answers it. "done" once pressed; null when X's dock draws no such control.
 */
export const xSpaceDockPress = async (
  label:
    | "Leave"
    | "End"
    | "Close"
    | "Request to speak"
    | "Request sent"
    | "Mute"
    | "Unmute"
    | "Share"
    | "Play"
    | "Pause"
    | "Skip backward 15 seconds"
    | "Skip forward 15 seconds",
  over: (shown: boolean) => void,
  spaceId: string,
) => {
  if (!validSpace(spaceId)) return null;
  const header = label === "Leave" || label === "End" || label === "Close";
  // X's page for the ended Space, which X opens once End is confirmed, is no question for the user.
  const asking = `!(${ON_PEEK(spaceId)}) && ${ASKING}`;
  const answer = await xPressOver(
    (mine) => `(async () => {
    const dock = (${spaceDockRoot.toString()})(document);
    const button = ${header ? `dock?.word === ${JSON.stringify(label)} ? [...dock.box.querySelectorAll('[role="button"], button')].find((b) => !b.hasAttribute("aria-label") && b.textContent.trim() === ${JSON.stringify(label)}) : null` : `dock?.box.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`};
    if (!button || !${mine}) return null;
    button.click();
    // Only End (its confirm) and Share (its sheet) answer with something for the user to answer.
    for (let i = 0; i < ${label === "End" || label === "Share" ? 10 : 0}; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (${asking}) return "over";
    }
    return "done";
  })()`,
    asking,
    over,
  );
  return answer === "over" || answer === "done" || answer === "cancelled" ? answer : null;
};

/** Opens X's "..." in its dock and finds its row `label`, in X's page. */
const dockMenuRow = (label: string) => `
    const dock = (${spaceDockRoot.toString()})(document);
    const more = dock?.box.querySelector('[aria-label="More"]');
    if (!more) return null;
    more.click();
    let row = null;
    for (let i = 0; i < 20 && !row; i++) {
      await new Promise((r) => setTimeout(r, 100));
      row = [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === ${JSON.stringify(label)});
    }`;

/**
 * Turns X's captions on (`on`) or off for the user's click, through the row of X's "..." in its
 * dock ("Show captions", "Hide captions"). Null when X offers no such row (X has none for the Space).
 */
export const xSpaceCaptions = async (on: boolean) =>
  (await xPressOver(
    (mine) => `(async () => {
    // A recording's player has its own captions button; a live Space has the row in its "...".
    const own = (${spaceDockRoot.toString()})(document)?.box.querySelector(${JSON.stringify(`[aria-label="${on ? "Show captions" : "Hide captions"}"]`)});
    if (own) return ${mine} ? (own.click(), "done") : null;
    ${dockMenuRow(on ? "Show captions" : "Hide captions")}
    if (!row || !${mine}) return (document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), null);
    row.click();
    return "done";
  })()`,
    "false",
    () => {},
  )) === "done" || null;

/** X's React in its dock and the picker it opens, in X's page. */
const REACTIONS = `
    const dock = (${spaceDockRoot.toString()})(document);
    const react = dock?.box.querySelector('[aria-label="React"]');
    if (!react) return null;
    react.click();
    let items = [];
    for (let i = 0; i < 20 && items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      items = [...document.querySelectorAll('[aria-label^="React with "]')];
    }
    const close = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`;

const decodeEmoji = Schema.decodeUnknownOption(Schema.Array(Schema.String));

/** X's reactions, read from X's own picker for the user's click on Xtend's. Presses none of them. */
export const xSpaceReactions = async () =>
  Option.getOrNull(
    decodeEmoji(
      await xRun(`(async () => {
    ${REACTIONS}
    const emoji = items.map((b) => b.getAttribute("aria-label").slice("React with ".length));
    close();
    return emoji.length === 0 ? null : emoji;
  })()`),
    ),
  );

/** Sends reaction `emoji` through X's own picker for the user's click. Null when X offers none such. */
export const xSpaceReact = async (emoji: string) =>
  (await xPressOver(
    (mine) => `(async () => {
    ${REACTIONS}
    const item = items.find((b) => b.getAttribute("aria-label") === ${JSON.stringify(`React with ${emoji}`)});
    if (!item || !${mine}) return (close(), null);
    item.click();
    return "done";
  })()`,
    "false",
    () => {},
  )) === "done" || null;

/** X's speeds for a recording, as its speed menu names them. */
export const SPACE_SPEEDS = ["0.5x speed", "Normal", "1.5x speed", "2x speed"] as const;

/** Picks speed `row` in X's speed menu on its player for the user's click. Null when X has none. */
export const xSpaceSpeed = async (row: (typeof SPACE_SPEEDS)[number]) =>
  (await xPressOver(
    (mine) => `(async () => {
    const button = (${spaceDockRoot.toString()})(document)?.box.querySelector('[aria-label^="Speed "]');
    if (!button || !${mine}) return null;
    button.click();
    let item = null;
    for (let i = 0; i < 20 && !item; i++) {
      await new Promise((r) => setTimeout(r, 100));
      item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === ${JSON.stringify(row)});
    }
    if (!item) return (document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })), null);
    item.click();
    return "done";
  })()`,
    "false",
    () => {},
  )) === "done" || null;

/**
 * Moves X's player to `fraction` of the recording for the user's click, through X's own seek
 * slider: a pointer's press and release at that point of it, as a click there is.
 */
export const xSpaceSeek = async (fraction: number) =>
  Number.isFinite(fraction) &&
  ((await xPressOver(
    (mine) => `(async () => {
    const slider = (${spaceDockRoot.toString()})(document)?.box.querySelector('[role="slider"]');
    if (!slider || !${mine}) return null;
    const box = slider.getBoundingClientRect();
    const at = { clientX: box.left + box.width * ${Math.min(1, Math.max(0, fraction))}, clientY: box.top + box.height / 2, bubbles: true, button: 0 };
    for (const [Kind, type] of [[PointerEvent, "pointerdown"], [MouseEvent, "mousedown"], [PointerEvent, "pointerup"], [MouseEvent, "mouseup"], [MouseEvent, "click"]])
      slider.dispatchEvent(new Kind(type, { ...at, pointerId: 1, isPrimary: true }));
    return "done";
  })()`,
    "false",
    () => {},
  )) === "done" ||
    null);

const START = "/i/spaces/start";

/**
 * Opens X's own Create your Space for the user's click, over the main area until X is off it with
 * no dialog up: started (X's dock then plays it), or closed. False when X showed none.
 */
export const xSpaceStart = async (over: (shown: boolean) => void) => {
  await xGo(`https://x.com${START}`);
  const answer = await xPressOver(
    () => `(async () => {
    for (let i = 0; i < 30 && location.pathname !== ${JSON.stringify(START)}; i++) await new Promise((r) => setTimeout(r, 100));
    return location.pathname === ${JSON.stringify(START)} ? "over" : null;
  })()`,
    `location.pathname === ${JSON.stringify(START)} || !!document.querySelector('[role="dialog"], [role="alertdialog"]')`,
    over,
  );
  return answer === "over";
};

export const SPACES_ANALYTICS = "/i/account_analytics/spaces";

/**
 * What X's Space analytics page shows the account once X drew it: true for X's upsell (its
 * "Upgrade to continue", or the Premium sign-up X sends to), false for X's list of Spaces, null
 * when X shows neither in time. Reads only.
 */
export const xSpacesUpsell = async (loaded: Promise<unknown>, signal: AbortSignal) => {
  await loaded;
  const seen = await xRunHeld(
    `(async () => {
    for (let i = 0; i < 100; i++) {
      if (location.pathname.startsWith("/i/premium_sign_up") || document.body.innerText.includes("Upgrade to continue")) return true;
      if (location.pathname.startsWith(${JSON.stringify(SPACES_ANALYTICS)}) && (document.querySelector('[aria-label="Filter spaces"], a[href^="${SPACES_ANALYTICS}/"]') || document.body.innerText.includes("No spaces available for the selected filter"))) return false;
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  })()`,
    signal,
  );
  return typeof seen === "boolean" ? seen : null;
};
