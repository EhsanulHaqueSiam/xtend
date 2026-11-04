import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { EngineSpace, EngineSpaceCaption, EngineSpacePerson } from "@xtend/contracts";
import { Captions, MessageCircle, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import {
  SPACE_SPEEDS,
  spaceLiveAtom,
  spacePhase,
  xSpaceCaptions,
  xSpaceDockPress,
  xSpaceRead,
  xSpaceSeek,
  xSpaceSpeed,
} from "../../state/spaces";
import { xOverAtom } from "../../state/x";
import { fmt } from "../analyze/ui";
import { Menu, MenuItem } from "../ui/menu";
import { ago, ROLE, usePlayRecording, useTracked } from "./SpaceDock";
import { useXPress } from "./useXPress";
import { useXScrollParent, XColumn, XTitle } from "./XColumn";
import { Avatar } from "./XPostView";

/** "6:12", or "1:06:12" past an hour, as X writes a recording's times. */
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60));
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm.padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

interface Line {
  readonly caption: EngineSpaceCaption;
  readonly person: EngineSpacePerson | undefined;
  /** Where in the recording it was said, ms. */
  readonly at: number;
}

const ROUND =
  "grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-white/[0.2] transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50";

/**
 * A Space's recording read like a thread: one row per thing said, from X's own captions, with X's
 * player under it. X sends captions only while its captions are on, a page at a time around where
 * it plays, so rows fill in as the recording plays; without any, the speakers and the player.
 */
export function SpaceRecording({ spaceId }: { readonly spaceId: string }) {
  const engine = useAtomValue(engineAtom);
  const space = engine.spaces.get(spaceId);
  const router = useRouter();
  const known = space !== undefined;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- asks X's own page for a Space no card in X's page answered for yet.
  useEffect(() => {
    if (!known) void xSpaceRead(spaceId);
  }, [known, spaceId]);
  return (
    <XColumn
      header={<XTitle title="Space" onBack={() => router.history.back()} />}
      rail={space === undefined ? null : <RecordingRail space={space} />}
      docked={false}
    >
      {space === undefined ? (
        <p className="px-4 py-6 text-[15px] text-[#71767b]">Loading the Space from X.</p>
      ) : (
        <Recording space={space} captions={engine.spaceCaptions.get(spaceId) ?? []} />
      )}
    </XColumn>
  );
}

function Recording({
  space,
  captions,
}: {
  readonly space: EngineSpace;
  readonly captions: ReadonlyArray<EngineSpaceCaption>;
}) {
  const tracked = useTracked(space);
  const live = useAtomValue(spaceLiveAtom);
  const playRecording = usePlayRecording();
  const { blocked, setToast } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const navigate = useNavigate();
  const scroller = useXScrollParent();
  const [busy, setBusy] = useState(false);
  // X's player plays this recording: the user started it from here, and X still draws it.
  const player = live.joined === space.spaceId ? (live.read?.player ?? null) : null;
  const read = live.joined === space.spaceId ? live.read : null;
  const start = Date.parse(space.startedAt ?? "");
  const lines: ReadonlyArray<Line> = captions.map((caption) => ({
    caption,
    person: space.people.find((p) => p.periscopeId === caption.periscopeId),
    at: Date.parse(caption.at) - start,
  }));
  const now = player === null ? -1 : lines.findLastIndex((l) => l.at <= player.at);
  const length = player?.length ?? null;
  const host = space.people.find((p) => p.role === "host");
  const others = space.people.filter((p) => p.role === "cohost" || p.role === "speaker");
  const tuned = (space.listening ?? 0) + (space.replays ?? 0);

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
  const play = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await playRecording(space);
    } finally {
      setBusy(false);
    }
  };
  const seek = (ms: number) =>
    length === null || length === 0
      ? undefined
      : void press(async () => (await xSpaceSeek(ms / length)) === true);
  const control = (label: Parameters<typeof xSpaceDockPress>[0]) =>
    void press(async () => (await xSpaceDockPress(label, setOver, space.spaceId)) !== null);

  return (
    <div data-x="space-recording" className="flex min-h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#71767b]">
          <span className="rounded border border-[#f4212e]/60 px-1.5 py-0.5 font-bold text-[#f4212e]">
            {spacePhase(space) === "recorded" ? "RECORDED" : "ENDED"}
          </span>
          {space.community === null ? null : (
            <span className="rounded border border-white/[0.2] px-1.5 py-0.5">
              {space.community.name}
            </span>
          )}
          {space.endedAt === null ? null : <span>Ended {ago(space.endedAt)}</span>}
          {length === null ? null : <span>· {clock(length)}</span>}
        </p>
        <h2 className="mt-1.5 text-[20px] leading-6 font-extrabold">{space.title}</h2>
        <p className="mt-1 text-[13px] text-[#71767b]">
          {host === undefined ? "" : `${host.name} hosted`}
          {others.length === 0
            ? ""
            : ` with ${others
                .slice(0, 3)
                .map((p) => p.name.split(" ")[0])
                .join(", ")}${others.length > 3 ? ` and ${others.length - 3} more` : ""}`}
          {tuned > 0 ? ` · ${fmt(tuned)} tuned in` : ""}
        </p>
      </div>
      {lines.length === 0 ? (
        <>
          <ul className="flex flex-col">
            {[...(host === undefined ? [] : [host]), ...others].map((p) => (
              <li
                key={p.handle}
                className="flex items-center gap-3 border-b border-border px-4 py-3"
              >
                <Avatar url={p.avatarUrl} size={40} />
                <span className="min-w-0 flex-1 text-[15px] leading-5">
                  <b className="block truncate">{p.name}</b>
                  <span className="text-[#71767b]">{tracked.get(p.handle) ?? ROLE[p.role]}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 py-4 text-[13px] text-[#71767b]">
            {read?.captions === null || read === null
              ? "Turn on captions while it plays to read it here."
              : "X has no captions here yet."}
          </p>
        </>
      ) : scroller === null ? null : (
        <Virtuoso
          customScrollParent={scroller}
          data={lines}
          computeItemKey={(_, l) => `${l.caption.at} ${l.caption.periscopeId}`}
          itemContent={(i, l) => (
            <button
              type="button"
              data-x="caption"
              aria-current={i === now ? "true" : undefined}
              disabled={length === null}
              className={cn(
                "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors duration-150 enabled:cursor-pointer enabled:hover:bg-white/[0.03]",
                i === now && "bg-white/[0.04]",
              )}
              onClick={() => seek(l.at)}
            >
              <Avatar url={l.person?.avatarUrl ?? null} size={40} />
              <span className="min-w-0 flex-1 text-[15px] leading-5">
                <span className="flex items-center gap-1.5">
                  <b className="truncate">{l.person?.name ?? "Someone"}</b>
                  {l.person === undefined ? null : tracked.has(l.person.handle) ? (
                    <span className="font-mono text-[11px] text-success-foreground">
                      {tracked.get(l.person.handle)}
                    </span>
                  ) : (
                    <span className="text-[13px] text-[#71767b]">{ROLE[l.person.role]}</span>
                  )}
                  <span
                    className={cn(
                      "ml-auto font-mono text-[12px] tabular-nums",
                      i === now ? "text-[#7856ff]" : "text-[#71767b]",
                    )}
                  >
                    {clock(l.at)}
                  </span>
                </span>
                <span className="mt-0.5 block">{l.caption.text}</span>
              </span>
            </button>
          )}
        />
      )}
      <div className="sticky bottom-0 mt-auto border-t border-border bg-black/90 px-4 py-3 backdrop-blur-md">
        {player === null ? (
          <button
            type="button"
            disabled={busy || !space.recorded || window.desktopBridge === undefined}
            className="h-10 w-full cursor-pointer rounded-full text-[15px] font-bold text-white transition-[filter] duration-150 hover:brightness-110 disabled:cursor-default disabled:opacity-50"
            style={{ background: "#7856ff" }}
            onClick={() => void play()}
          >
            {window.desktopBridge === undefined
              ? "X plays recordings in the desktop app"
              : busy
                ? "Starting the recording"
                : space.recorded
                  ? "Play recording"
                  : "X kept no recording of this Space"}
          </button>
        ) : (
          <>
            <Scrubber
              at={player.at}
              length={player.length}
              ticks={lines.flatMap((l) =>
                l.person !== undefined && tracked.has(l.person.handle) ? [l.at] : [],
              )}
              onSeek={seek}
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[12px] text-[#71767b] tabular-nums">
                {clock(player.at)} / {clock(player.length)}
              </span>
              <button
                type="button"
                aria-label="Skip backward 15 seconds"
                disabled={busy}
                className={ROUND}
                onClick={() => control("Skip backward 15 seconds")}
              >
                <RotateCcw className="size-4" />
              </button>
              <button
                type="button"
                aria-label={player.playing ? "Pause" : "Play"}
                disabled={busy}
                className={cn(
                  ROUND,
                  "size-11 border-transparent bg-foreground text-background hover:bg-foreground",
                )}
                onClick={() => control(player.playing ? "Pause" : "Play")}
              >
                {player.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                aria-label="Skip forward 15 seconds"
                disabled={busy}
                className={ROUND}
                onClick={() => control("Skip forward 15 seconds")}
              >
                <RotateCw className="size-4" />
              </button>
              <Menu
                label="Playback speed"
                trigger={
                  <button
                    type="button"
                    disabled={busy}
                    className="h-7 cursor-pointer rounded border border-white/[0.2] px-1.5 font-mono text-[11px]"
                  >
                    {player.speed?.replace(/^Speed /, "") ?? "1x"}
                  </button>
                }
              >
                {SPACE_SPEEDS.map((row) => (
                  <MenuItem
                    key={row}
                    onClick={() => void press(async () => (await xSpaceSpeed(row)) === true)}
                  >
                    {row}
                  </MenuItem>
                ))}
              </Menu>
              <span className="flex-1" />
              <button
                type="button"
                aria-label={read?.captions == null ? "Show captions" : "Hide captions"}
                aria-pressed={read?.captions != null}
                disabled={busy}
                className={cn(
                  ROUND,
                  read?.captions != null &&
                    "border-transparent bg-foreground text-background hover:bg-foreground",
                )}
                onClick={() =>
                  void press(async () => (await xSpaceCaptions(read?.captions == null)) === true)
                }
              >
                <Captions className="size-4" />
              </button>
              <button
                type="button"
                className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-white/[0.2] px-3 text-[15px] font-bold hover:bg-white/[0.06]"
                onClick={() =>
                  void navigate({
                    href: `/compose?text=${encodeURIComponent(`https://x.com/i/spaces/${space.spaceId}`)}`,
                  })
                }
              >
                <MessageCircle className="size-4" />
                Reply
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Where X's player is in the recording, with a tick where each person the account tracks spoke. */
function Scrubber({
  at,
  length,
  ticks,
  onSeek,
}: {
  readonly at: number;
  readonly length: number;
  readonly ticks: ReadonlyArray<number>;
  readonly onSeek: (ms: number) => void;
}) {
  const share = (ms: number) => `${length === 0 ? 0 : Math.min(100, (ms / length) * 100)}%`;
  const seek = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - box.left) / box.width) * length);
  };
  return (
    <button
      type="button"
      aria-label="Seek"
      className="relative block h-5 w-full cursor-pointer"
      onClick={seek}
    >
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-white/[0.2]" />
      <span
        className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-foreground"
        style={{ width: share(at) }}
      />
      {ticks.map((t) => (
        <span
          key={t}
          data-x="tick"
          className="absolute top-0 h-2 w-0.5 bg-[#7856ff]"
          style={{ left: share(t) }}
        />
      ))}
      <span
        className="absolute top-1/2 size-3 -translate-1/2 rounded-full bg-foreground"
        style={{ left: share(at) }}
      />
    </button>
  );
}

/** The rail beside a recording: the people the account tracks in it, and the Space's numbers. */
function RecordingRail({ space }: { readonly space: EngineSpace }) {
  const tracked = useTracked(space);
  const { spaceCaptions, spaceStats } = useAtomValue(engineAtom);
  const said = spaceCaptions.get(space.spaceId) ?? [];
  const stats = spaceStats.get(space.spaceId);
  const speakers = space.people.filter((p) => p.role !== "listener").length;
  const rows: ReadonlyArray<readonly [string, number | null]> = [
    ["Tuned in", (space.listening ?? 0) + (space.replays ?? 0)],
    // X's analytics, for the user's own Spaces only.
    ...(stats === undefined
      ? []
      : ([
          ["Peak at once", stats.concurrent.length === 0 ? 0 : Math.max(...stats.concurrent)],
          ["Total participants", stats.participants],
        ] as const)),
    ["Replay plays", space.replays],
    ["Speakers", speakers],
  ];
  return (
    <>
      {tracked.size === 0 ? null : (
        <section className="rounded-2xl border border-white/[0.12] px-4 py-3">
          <h2 className="mb-2.5 text-[17px] leading-6 font-extrabold">People you track</h2>
          <ul className="flex flex-col gap-3">
            {space.people
              .filter((p) => tracked.has(p.handle))
              .map((p) => {
                const n = said.filter((c) => c.periscopeId === p.periscopeId).length;
                return (
                  <li key={p.handle} className="flex items-center gap-2.5 text-[15px] leading-5">
                    <Avatar url={p.avatarUrl} size={32} />
                    <span className="min-w-0">
                      <b className="block truncate">{p.name}</b>
                      <span className="text-[13px] text-[#71767b]">
                        {n === 0
                          ? p.role === "listener"
                            ? "Listened"
                            : ROLE[p.role]
                          : n === 1
                            ? "Spoke once"
                            : `Spoke ${n} times`}{" "}
                        · {tracked.get(p.handle)}
                      </span>
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
      <section className="rounded-2xl border border-white/[0.12] px-4 py-3">
        <h2 className="mb-2.5 text-[17px] leading-6 font-extrabold">This Space</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[15px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-[#71767b]">{k}</dt>
              <dd className="text-right font-mono text-[13px] tabular-nums">
                {v === null ? "-" : v.toLocaleString("en")}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
