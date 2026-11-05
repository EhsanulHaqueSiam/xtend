import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { EngineSpace, EngineSpacePerson, Person } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  Captions,
  ChevronDown,
  ChevronUp,
  Hand,
  Heart,
  MessageCircle,
  Mic,
  MicOff,
  Share,
  Users,
  X as Close,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import { trackedPeopleAtom } from "../../state/leads";
import {
  spaceDockAtom,
  spaceLiveAtom,
  spacePhase,
  spaceTargetsAtom,
  watchSpaceDock,
  xSpaceCaptions,
  xSpaceDockNow,
  xSpaceDockPress,
  xSpaceLeavePage,
  xSpaceListen,
  xSpaceReact,
  xSpaceReactions,
  xSpaceRead,
  xSpaceStart,
  SPACE_ERROR,
} from "../../state/spaces";
import { xOverAtom } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Menu, MenuItem } from "../ui/menu";
import { xAge } from "./format";
import { SPACE_PURPLE } from "./SpaceCard";
import { useXPress } from "./useXPress";
import { Avatar } from "./XPostView";

const ROLE: Readonly<Record<EngineSpacePerson["role"], string>> = {
  host: "Host",
  cohost: "Co-host",
  speaker: "Speaker",
  listener: "Listener",
};

/** "9m ago", or the day for anything older than a day. */
const ago = (iso: string) => {
  const age = xAge(iso);
  return /^\d+[smh]$/.test(age) ? `${age} ago` : age;
};

/** Faces the dock draws before X's "+N more", as X's 360px dock fits them. */
const FACES = 11;

/** A tracked person's label: their stage as a lead, or Target for someone the account replies under. */
const trackedLabel = (lead: Person | undefined, target: boolean) =>
  lead === undefined ? (target ? "Target" : null) : `Lead · ${lead.stage}`;

/**
 * The account's leads and reply targets among the Space's people, each with its label: free, from
 * Xtend's own data for this account.
 */
function useTracked(space: EngineSpace) {
  const handles = space.people.map((p) => p.handle);
  const leads = AsyncResult.getOrElse(useAtomValue(trackedPeopleAtom(handles.join(" "))), () => []);
  const targets = AsyncResult.getOrElse(useAtomValue(spaceTargetsAtom), () => new Set<string>());
  return new Map(
    space.people.flatMap((p) => {
      const label = trackedLabel(
        leads.find((l) => l.handle === p.handle),
        targets.has(p.handle),
      );
      return label === null ? [] : [[p.handle, label] as const];
    }),
  );
}

/**
 * Reads X's dock while Xtend's is open or X plays a Space, and keeps which Space the user joined
 * from Xtend; once X's dock is gone (Leave, End, X ended it), so is the join. Desktop only.
 */
export function SpaceSync() {
  const [dock, setDock] = useAtom(spaceDockAtom);
  const [live, setLive] = useAtom(spaceLiveAtom);
  const { spaces, viewer } = useAtomValue(engineAtom);
  const watching = dock !== null || live.read !== null;
  // X's dock with End is the user's own Space, which X's page names in its answers: the host.
  const hosted =
    live.read?.word === "End" && live.joined === null
      ? [...spaces.values()].find(
          (s) =>
            s.state === "Running" &&
            s.people[0]?.role === "host" &&
            s.people[0].handle === viewer?.handle.toLowerCase(),
        )?.spaceId
      : undefined;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- follows X's dock to the Space the user hosts, once X's answer names it.
  useEffect(() => {
    if (hosted === undefined) return;
    setLive((l) => ({ ...l, joined: hosted }));
    setDock(hosted);
  }, [hosted, setLive, setDock]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's own dock in the session view while a Space is open or playing.
  useEffect(() => {
    if (!watching) return;
    const stop = new AbortController();
    watchSpaceDock(stop.signal, (read) =>
      setLive((l) => ({ read, joined: read === null ? null : l.joined })),
    );
    return () => stop.abort();
  }, [watching, setLive]);
  return null;
}

/**
 * X's own Create your Space for the user's click, over the main area; once X started it, the dock
 * follows X's to the Space the user hosts (`SpaceSync`).
 */
export function useSpaceStart() {
  const setOver = useAtomSet(xOverAtom);
  const setLive = useAtomSet(spaceLiveAtom);
  const { blocked, setToast } = useXPress();
  return async () => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    if (!(await xSpaceStart(setOver)))
      return setToast({ text: "X did not open Create your Space. Try again in a moment." });
    const read = await xSpaceDockNow();
    if (read !== null) setLive({ read, joined: null });
  };
}

const ROUND =
  "grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-white/[0.2] transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50";
const ICON =
  "grid size-8 cursor-pointer place-items-center rounded-full text-[#71767b] transition-colors duration-150 hover:bg-white/[0.06] hover:text-foreground";

/**
 * X's Space dock in the right column: X's state, title, host, speakers and listeners from X's own
 * answer, the people the account tracks among them, and X's own controls once the user joined.
 * Opening it joins nothing.
 */
export function SpaceDock({ spaceId }: { readonly spaceId: string }) {
  const engine = useAtomValue(engineAtom);
  const space = engine.spaces.get(spaceId);
  const unavailable = engine.spacesUnavailable.has(spaceId);
  const setDock = useAtomSet(spaceDockAtom);
  const known = space !== undefined;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- asks X's own page for a Space no card in X's page answered for yet.
  useEffect(() => {
    if (!known) void xSpaceRead(spaceId);
  }, [known, spaceId]);
  if (space === undefined)
    return (
      <section
        data-x="space-dock"
        className="flex items-center gap-2 rounded-2xl border border-white/[0.12] px-4 py-3 text-[15px]"
      >
        <span className="flex-1 text-[#71767b]">
          {unavailable ? SPACE_ERROR : "Loading the Space from X."}
        </span>
        <button type="button" aria-label="Close" className={ICON} onClick={() => setDock(null)}>
          <Close className="size-4" />
        </button>
      </section>
    );
  return <SpaceDockBody space={space} onClose={() => setDock(null)} />;
}

function Face({ person }: { readonly person: EngineSpacePerson }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1 text-center">
      <Avatar url={person.avatarUrl} size={44} />
      <span className="w-full truncate text-[13px] font-bold">{person.name}</span>
      <span className="flex items-center gap-0.5 text-[12px] text-[#71767b]">
        {person.role === "listener" ? null : person.muted ? (
          <MicOff className="size-3" aria-label="Muted" />
        ) : (
          <Mic className="size-3" aria-label="Mic on" />
        )}
        {ROLE[person.role]}
      </span>
    </li>
  );
}

function SpaceDockBody({
  space,
  onClose,
}: {
  readonly space: EngineSpace;
  readonly onClose: () => void;
}) {
  const phase = spacePhase(space);
  const tracked = useTracked(space);
  const [live, setLive] = useAtom(spaceLiveAtom);
  const [collapsed, setCollapsed] = useState(false);
  const [people, setPeople] = useState(false);
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  // X's dock plays this Space: the user joined it from here, and X still draws its dock.
  const read = live.joined === space.spaceId ? live.read : null;
  const more = Math.max(0, (space.total ?? space.people.length) - FACES);

  /** One press of X's own control at a time, only while session actions are on. */
  const press = async (run: () => Promise<boolean>) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    if (busy) return;
    setBusy(true);
    try {
      if (!(await run())) setToast({ text: "X did not take that. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };
  const listen = () =>
    press(async () => {
      const joined = await xSpaceListen(space.spaceId);
      if (joined === true) setLive((l) => ({ ...l, joined: space.spaceId }));
      return joined === true;
    });
  const dockPress = (label: Parameters<typeof xSpaceDockPress>[0]) =>
    press(async () => {
      const done = await xSpaceDockPress(label, setOver, space.spaceId);
      // X shows the Space's own page once its host ended it: the screen's page comes back.
      if (label === "End" && done !== null) await xSpaceLeavePage(space.spaceId);
      return done !== null;
    });
  const caption = read?.captions?.at(-1);

  return (
    <section
      data-x="space-dock"
      aria-label={space.title}
      className="flex flex-col gap-3 rounded-2xl border border-white/[0.12] px-4 py-3"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          className={ICON}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {read === null ? null : (
          <button
            type="button"
            aria-label="Share"
            className={ICON}
            onClick={() => void dockPress("Share")}
          >
            <Share className="size-4" />
          </button>
        )}
        <span className="flex-1" />
        {read === null ? (
          <button type="button" aria-label="Close" className={ICON} onClick={onClose}>
            <Close className="size-4" />
          </button>
        ) : read.word === "Close" ? null : (
          <button
            type="button"
            disabled={busy}
            className="cursor-pointer px-2 text-[15px] font-bold text-[#f4212e] disabled:opacity-50"
            onClick={() => void dockPress(read.word === "End" ? "End" : "Leave")}
          >
            {read.word}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        {phase === "live" ? (
          <span
            className="rounded px-1.5 py-0.5 font-bold text-white"
            style={{ background: SPACE_PURPLE }}
          >
            LIVE
          </span>
        ) : (
          <span className="rounded border border-white/[0.2] px-1.5 py-0.5 text-[#71767b]">
            {phase === "scheduled" ? "SCHEDULED" : phase === "recorded" ? "RECORDED" : "ENDED"}
          </span>
        )}
        {space.community === null ? null : (
          <span className="rounded border border-white/[0.2] px-1.5 py-0.5">
            {space.community.name}
          </span>
        )}
        {phase === "live" && space.listening !== null ? (
          <span className="rounded border border-white/[0.2] px-1.5 py-0.5">
            {fmt(space.listening)} listening
          </span>
        ) : null}
      </div>
      <h2 className="text-[17px] leading-6 font-extrabold">{space.title}</h2>
      {collapsed ? null : people ? (
        <PeopleList space={space} tracked={tracked} />
      ) : (
        <>
          <p className="-mt-2 text-[13px] text-[#71767b]">
            {phase === "live" && space.startedAt !== null
              ? `Started ${ago(space.startedAt)}`
              : phase === "scheduled" && space.scheduledStart !== null
                ? `Starts ${new Date(space.scheduledStart).toLocaleString()}`
                : space.endedAt !== null
                  ? `Ended ${ago(space.endedAt)}`
                  : ""}
          </p>
          <ul className="grid grid-cols-4 gap-x-2 gap-y-3">
            {space.people.slice(0, FACES).map((p) => (
              <Face key={p.handle} person={p} />
            ))}
            {more > 0 ? (
              <li className="flex flex-col items-center gap-1 text-center text-[13px] text-[#71767b]">
                <span className="grid size-11 place-items-center rounded-full bg-white/[0.08]">
                  +{fmt(more)}
                </span>
                more
              </li>
            ) : null}
          </ul>
          {tracked.size === 0 ? null : (
            <div className="border-t border-white/[0.12] pt-3">
              <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-[#71767b] uppercase">
                People you track · {tracked.size}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {space.people
                  .filter((p) => tracked.has(p.handle))
                  .map((p) => (
                    <TrackedRow key={p.handle} person={p} label={tracked.get(p.handle)!} />
                  ))}
              </ul>
            </div>
          )}
          {caption === undefined ? null : (
            <div className="border-t border-white/[0.12] pt-3 text-[15px] leading-5">
              <p className="mb-1 text-[13px] text-[#71767b]">{caption.name} · captions</p>
              <p>{caption.text}</p>
            </div>
          )}
        </>
      )}
      {phase !== "live" ? null : window.desktopBridge === undefined ? (
        <p className="text-[13px] text-[#71767b]">X plays Spaces in the desktop app.</p>
      ) : read === null ? (
        <button
          type="button"
          disabled={busy}
          className="h-10 cursor-pointer rounded-full bg-foreground text-[15px] font-bold text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
          onClick={() => void listen()}
        >
          Start listening
        </button>
      ) : (
        <div className="flex items-center gap-2 border-t border-white/[0.12] pt-3">
          {read.request === null ? null : (
            <button
              type="button"
              aria-label={read.request === "Request sent" ? "Cancel request" : read.request}
              disabled={busy}
              className={ROUND}
              onClick={() =>
                void dockPress(
                  read.request === "Request sent" ? "Request sent" : "Request to speak",
                )
              }
            >
              <Hand className={cn("size-4", read.request === "Request sent" && "text-[#1d9bf0]")} />
            </button>
          )}
          {read.mic === null ? null : (
            <button
              type="button"
              aria-label={read.mic}
              disabled={busy}
              className={cn(
                ROUND,
                read.mic === "Unmute" && "border-transparent bg-[#f4212e] hover:bg-[#f4212e]/90",
              )}
              onClick={() => void dockPress(read.mic!)}
            >
              {read.mic === "Unmute" ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
          )}
          {read.react ? (
            <ReactButton
              disabled={busy}
              onReact={(e) => void press(async () => (await xSpaceReact(e)) === true)}
            />
          ) : null}
          <button
            type="button"
            aria-label={read.captions === null ? "Show captions" : "Hide captions"}
            aria-pressed={read.captions !== null}
            disabled={busy}
            className={cn(
              ROUND,
              read.captions !== null &&
                "border-transparent bg-foreground text-background hover:bg-foreground",
            )}
            onClick={() =>
              void press(async () => (await xSpaceCaptions(read.captions === null)) === true)
            }
          >
            <Captions className="size-4" />
          </button>
          <span className="flex-1" />
          <DockToggle label="People" on={people} onClick={() => setPeople(!people)}>
            <Users className="size-4" />
          </DockToggle>
          <button
            type="button"
            aria-label="Reply"
            className={ROUND}
            onClick={() =>
              void navigate({
                href: `/compose?text=${encodeURIComponent(`https://x.com/i/spaces/${space.spaceId}`)}`,
              })
            }
          >
            <MessageCircle className="size-4" />
          </button>
        </div>
      )}
    </section>
  );
}

function DockToggle({
  label,
  on,
  onClick,
  children,
}: {
  readonly label: string;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      className={cn(ROUND, on && "border-transparent bg-white/[0.12]")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** X's React: its own emoji, read from X's picker when the menu opens. */
function ReactButton({
  disabled,
  onReact,
}: {
  readonly disabled: boolean;
  readonly onReact: (emoji: string) => void;
}) {
  const [emoji, setEmoji] = useState<ReadonlyArray<string> | null>(null);
  return (
    <Menu
      label="React"
      onOpenChange={(open) => {
        if (open) void xSpaceReactions().then((e) => setEmoji(e ?? []));
      }}
      trigger={
        <button type="button" aria-label="React" disabled={disabled} className={ROUND}>
          <Heart className="size-4" />
        </button>
      }
    >
      {emoji === null ? (
        <MenuItem disabled onClick={() => {}}>
          Loading from X
        </MenuItem>
      ) : emoji.length === 0 ? (
        <MenuItem disabled onClick={() => {}}>
          X offers no reactions here
        </MenuItem>
      ) : (
        emoji.map((e) => (
          <MenuItem key={e} onClick={() => onReact(e)}>
            <span aria-label={`React with ${e}`}>{e}</span>
          </MenuItem>
        ))
      )}
    </Menu>
  );
}

function TrackedRow({
  person,
  label,
}: {
  readonly person: EngineSpacePerson;
  readonly label: string;
}) {
  return (
    <li className="flex items-center gap-2 text-[13px]">
      <Avatar url={person.avatarUrl} size={20} />
      <b className="truncate">{person.name}</b>
      <span className="shrink-0 text-[#71767b]">{ROLE[person.role]}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-success-foreground">
        {label}
      </span>
    </li>
  );
}

/** Everyone X lists in the Space, virtualized: a big Space lists hundreds. */
function PeopleList({
  space,
  tracked,
}: {
  readonly space: EngineSpace;
  readonly tracked: ReadonlyMap<string, string>;
}) {
  return (
    <Virtuoso
      data-x="space-people"
      style={{ height: 360 }}
      data={space.people}
      computeItemKey={(_, p) => p.handle}
      itemContent={(_, p) => (
        <div className="flex items-center gap-2 py-1.5 text-[13px]">
          <Avatar url={p.avatarUrl} size={32} />
          <span className="min-w-0 flex-1">
            <b className="block truncate">{p.name}</b>
            <span className="block truncate text-[#71767b]">@{p.handle}</span>
          </span>
          <span className="shrink-0 text-[#71767b]">{ROLE[p.role]}</span>
          {tracked.has(p.handle) ? (
            <span className="shrink-0 font-mono text-[11px] text-success-foreground">
              {tracked.get(p.handle)}
            </span>
          ) : null}
        </div>
      )}
    />
  );
}
