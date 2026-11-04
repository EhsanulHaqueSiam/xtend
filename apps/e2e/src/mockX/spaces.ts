import type {
  EngineBatch,
  EngineSpace,
  EngineSpaceCaption,
  EngineSpacePerson,
  EngineViewer,
} from "@xtend/contracts";

/**
 * X's Spaces on the mock: the fixtures' Spaces and one the user starts, X's pages for them, and X's
 * dock (no test ids, so its controls carry X's labels: Leave, End, Collapse, Request to speak, Mute,
 * React, More, Share). Presses change this state and the press log; nothing is sent anywhere.
 */

interface Dock {
  readonly spaceId: string;
  /** "replay": X's player for a recording, not a live Space. */
  readonly role: "host" | "speaker" | "listener" | "replay";
  /** Where X's player is (ms), whether it plays, and its speed button's label. */
  readonly at: number;
  readonly playing: boolean;
  readonly speed: string;
  readonly requested: boolean;
  readonly muted: boolean;
  readonly captions: boolean;
}

/** X's reactions, in its picker's order. */
export const SPACE_REACTIONS = ["😂", "😲", "😢", "💜", "💯", "👏", "✊", "👍", "👎", "👋"];
/** The Space the user starts on the mock. */
export const STARTED_SPACE = "900000700002";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const button = (label: string, attrs: string, text = "") =>
  `<div role="button" tabindex="0" aria-label="${esc(label)}" ${attrs}>${text}</div>`;

export function createMockSpaces(batches: ReadonlyArray<EngineBatch>, viewer: EngineViewer) {
  const spaces = new Map<string, EngineSpace>(
    batches.flatMap((b) =>
      b.op === "AudioSpaceById" ? (b.spaces ?? []).map((s) => [s.spaceId, s] as const) : [],
    ),
  );
  let dock: Dock | null = null;
  /**
   * X's compact layout, which a narrow window gets: its pages are routes with X's app bar (its
   * back, the title as an h2), not dialogs, and its confirm is a sheet with no dialog role.
   */
  let compact = false;
  /** A page of X's: a dialog over the page, or in the compact layout a route with X's app bar. */
  const sheet = (attrs: string, title: string, body: string) =>
    compact
      ? `<div ${attrs}><div><div role="button" aria-label="Back" data-testid="app-bar-back" data-space-close>←</div><h2>${title}</h2></div>${body}</div>`
      : `<div class="dialog route" role="dialog" aria-modal="true" ${attrs}><div role="button" aria-label="Close" data-space-close>✕</div><h2>${title}</h2>${body}</div>`;
  /** Each recording's captions, as X's recording chat holds them. */
  const captions = new Map<string, ReadonlyArray<EngineSpaceCaption>>(
    batches.flatMap((b) =>
      b.op === "LiveChatReplay" && b.key !== null ? [[b.key, b.spaceCaptions ?? []] as const] : [],
    ),
  );
  const fresh = { at: 0, playing: true, speed: "Speed 1x" };
  const lengthOf = (s: EngineSpace) =>
    s.startedAt === null || s.endedAt === null
      ? 0
      : Date.parse(s.endedAt) - Date.parse(s.startedAt);
  const clock = (ms: number) => {
    const t = Math.floor(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  /** What X says in a Space with captions on, by its first speakers. */
  const said = ["Welcome in. We'll do twenty minutes on churn, then open the floor."];

  const me = (role: EngineSpacePerson["role"], muted: boolean): EngineSpacePerson => ({
    userId: viewer.userId,
    handle: viewer.handle,
    name: viewer.name ?? viewer.handle,
    avatarUrl: viewer.avatarUrl,
    verified: false,
    role,
    muted,
    ...(viewer.userId === null ? {} : { periscopeId: viewer.userId }),
  });
  /** A Space as X answers for it now: the user among its people once they joined. */
  const space = (id: string): EngineSpace | undefined => {
    const s = spaces.get(id);
    if (s === undefined || dock?.spaceId !== id || dock.role === "host" || dock.role === "replay")
      return s;
    const listening = (s.listening ?? 0) + 1;
    return {
      ...s,
      people: [...s.people, me(dock.role, dock.muted)],
      listening,
      total: listening,
    };
  };

  /** X's peek for a Space: its state, title and host, and its one button for what it is now. */
  const peek = (id: string) => {
    const s = space(id);
    if (s === undefined)
      return `<div class="dialog route" role="dialog"><p>This Space is unavailable.</p></div>`;
    const host = s.people.find((p) => p.role === "host");
    const cta =
      s.state === "Running"
        ? dock === null
          ? button("Start listening", `data-space-listen="${esc(id)}"`, "Start listening")
          : `<p>You cannot join this Space since you are already in a Space.</p>`
        : s.state === "NotStarted"
          ? button("Set reminder", `data-space-remind="${esc(id)}"`, "Set reminder")
          : s.recorded
            ? button("Play recording", `data-space-play="${esc(id)}"`, "Play recording")
            : "";
    return sheet(
      `data-space-peek="${esc(id)}"`,
      esc(s.title),
      `<p>${s.state === "Running" ? `${s.listening ?? 0} listening` : s.state}</p>
      ${host === undefined ? "" : `<div><b>${esc(host.name)}</b> <span>Host</span></div>`}
      ${cta}`,
    );
  };

  /** X's Create your Space, over the page: its title field and Start now. */
  const start = () =>
    sheet(
      "data-space-start",
      "Create your Space",
      `<label>Who can speak?<span>Everyone</span></label>
    <input name="title" placeholder="What do you want to talk about?">
    <label>Record Space<input type="checkbox" role="switch" checked></label>
    ${button("Start now", "data-space-start-now", "Start now")}`,
    );

  /** X's player for a recording: its Close, captions panel, seek slider and times, controls. */
  const replayHtml = (d: Dock) => {
    const s = spaces.get(d.spaceId)!;
    const length = lengthOf(s);
    const start = Date.parse(s.startedAt ?? "");
    const lines = (captions.get(d.spaceId) ?? []).filter((c) => Date.parse(c.at) - start <= d.at);
    const speaker = (c: EngineSpaceCaption) =>
      s.people.find((p) => p.periscopeId === c.periscopeId);
    return `<div data-mock-dock="${esc(d.spaceId)}">
      <div>${button("Collapse", "", "⌄")}<div role="button" tabindex="0" data-space-word>Close</div></div>
      <div>${esc(s.title)}</div>
      ${d.captions ? `<div role="listbox">${lines.map((c) => `<div><div>${esc(speaker(c)?.name ?? "")}</div><div>@${esc(speaker(c)?.handle ?? "")}</div><div>${esc(c.text)}</div></div>`).join("")}</div>` : ""}
      <div><div role="slider" aria-label="Seek slider" data-space-seek style="width:300px;height:10px;background:#333"></div><span>${clock(d.at)}</span><span>-${clock(length - d.at)}</span></div>
      <div>${button(d.captions ? "Hide captions" : "Show captions", "data-space-captions", "CC")}${button(d.speed, "data-space-speed", d.speed)}${button("Skip backward 15 seconds", 'data-space-skip="-15000"', "↺")}${button(d.playing ? "Pause" : "Play", "data-space-toggle", d.playing ? "❚❚" : "▶")}${button("Skip forward 15 seconds", 'data-space-skip="15000"', "↻")}</div>
    </div>`;
  };

  /** X's dock for the Space the user is in: header, captions panel when on, then its footer. */
  const dockHtml = () => {
    if (dock === null) return "";
    if (dock.role === "replay") return replayHtml(dock);
    const s = spaces.get(dock.spaceId);
    const word = dock.role === "host" ? "End" : "Leave";
    const captions = dock.captions
      ? `<div role="listbox">${said
          .map((text) => {
            const speaker = s?.people[0];
            return `<div><div>${esc(speaker?.name ?? "")}</div><div>@${esc(speaker?.handle ?? "")}</div><div>${esc(text)}</div></div>`;
          })
          .join("")}</div>`
      : "";
    const request =
      dock.role === "listener"
        ? button(dock.requested ? "Request sent" : "Request to speak", "data-space-request", "✋")
        : "";
    const mic =
      dock.role === "listener" ? "" : button(dock.muted ? "Unmute" : "Mute", "data-space-mic", "🎙");
    return `<div data-mock-dock="${esc(dock.spaceId)}"${compact ? " data-compact" : ""}>
      <div>${button("Collapse", "", "⌄")}${button("Share", "data-space-share", "⇪")}${button("More", "data-space-more", "…")}<div role="button" tabindex="0" data-space-word>${word}</div></div>
      <div>${esc(s?.title ?? "")}</div>
      ${captions}
      <div>${request}${mic}${button("React", "data-space-react", "♡")}</div>
    </div>`;
  };

  /** One of the page's presses on X's Space controls; false for one X would not take now. */
  const write = (body: Record<string, unknown>): boolean => {
    const id = typeof body.id === "string" ? body.id : "";
    switch (body.kind) {
      case "play": {
        const s = spaces.get(id);
        if (dock !== null || s?.recorded !== true || s.state !== "Ended") return false;
        dock = {
          spaceId: id,
          role: "replay",
          requested: false,
          muted: true,
          captions: false,
          ...fresh,
        };
        return true;
      }
      case "toggle":
        if (dock?.role !== "replay") return false;
        dock = { ...dock, playing: !dock.playing };
        return true;
      case "skip":
      case "seek": {
        if (dock?.role !== "replay") return false;
        const length = lengthOf(spaces.get(dock.spaceId)!);
        const to =
          body.kind === "skip" ? dock.at + Number(body.by) : Number(body.fraction) * length;
        if (!Number.isFinite(to)) return false;
        dock = { ...dock, at: Math.round(Math.min(length, Math.max(0, to))) };
        return true;
      }
      case "speed":
        if (dock?.role !== "replay" || typeof body.row !== "string") return false;
        dock = {
          ...dock,
          speed: `Speed ${body.row === "Normal" ? "1" : body.row.replace(/x speed$/, "")}x`,
        };
        return true;
      case "listen":
        if (dock !== null || spaces.get(id)?.state !== "Running") return false;
        dock = {
          spaceId: id,
          role: "listener",
          requested: false,
          muted: true,
          captions: false,
          ...fresh,
        };
        return true;
      case "start": {
        if (dock !== null) return false;
        const title = typeof body.title === "string" && body.title !== "" ? body.title : "Untitled";
        spaces.set(STARTED_SPACE, {
          spaceId: STARTED_SPACE,
          state: "Running",
          title,
          scheduledStart: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          listening: 0,
          replays: null,
          recorded: true,
          community: null,
          people: [me("host", false)],
          total: 1,
        });
        dock = {
          spaceId: STARTED_SPACE,
          role: "host",
          requested: false,
          muted: false,
          captions: false,
          ...fresh,
        };
        return true;
      }
      // X leaves the Space on Leave, and as its page unloads.
      case "leave":
      case "unload":
        if (dock === null) return false;
        dock = null;
        return true;
      case "end": {
        if (dock?.role !== "host") return false;
        const s = spaces.get(dock.spaceId)!;
        spaces.set(s.spaceId, { ...s, state: "Ended", endedAt: new Date().toISOString() });
        dock = null;
        return true;
      }
      case "request":
      case "cancel":
        if (dock?.role !== "listener" || dock.requested !== (body.kind === "cancel")) return false;
        dock = { ...dock, requested: body.kind === "request" };
        return true;
      case "mute":
      case "unmute":
        if (dock === null || dock.role === "listener" || dock.muted !== (body.kind === "unmute"))
          return false;
        dock = { ...dock, muted: body.kind === "mute" };
        return true;
      case "captions":
        if (dock === null) return false;
        dock = { ...dock, captions: !dock.captions };
        return true;
      case "react":
        return dock !== null && SPACE_REACTIONS.includes(String(body.emoji));
      default:
        return false;
    }
  };

  /** X's recording chat for a Space, as JSON lines: its captions, X's `ts` in nanoseconds. */
  const replayChat = (id: string) =>
    (captions.get(id) ?? [])
      .map((c) =>
        JSON.stringify({
          chatType: 45,
          final: true,
          message: c.text,
          userId: c.periscopeId,
          ts: `${Date.parse(c.at)}000000`,
        }),
      )
      .join("\n");

  return {
    space,
    replayChat,
    peek,
    start,
    dockHtml,
    write,
    /** The Space X's dock plays, and how; null while the user is in none. */
    get dock() {
      return dock;
    },
    /** X's compact layout on (a narrow window) or off. */
    setCompact: (on: boolean) => {
      compact = on;
    },
    /** The host lets the user speak, as a host's Invite to speak does on X. */
    invite: () => {
      if (dock?.role === "listener") dock = { ...dock, role: "speaker", requested: false };
    },
  };
}
