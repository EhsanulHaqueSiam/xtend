import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnginePost } from "@xtend/contracts";
import type { MouseEvent } from "react";

import { cn } from "../../lib/utils";
import { engineAtom } from "../../state/engine";
import { forgetSpaceRead, spaceDockAtom, spacePhase } from "../../state/spaces";
import { fmt } from "../analyze/ui";
import { xAge } from "./format";
import { Avatar } from "./XPostView";

/** X's purple for Spaces. */
export const SPACE_PURPLE = "#7856ff";

/**
 * X's card for a Space in a post: its state, title, faces and count, from X's answer for the Space.
 * A click opens the dock beside the screen and joins nothing.
 */
export function SpaceCard({ post }: { readonly post: Pick<EnginePost, "spaceId"> }) {
  const space = useAtomValue(engineAtom).spaces.get(post.spaceId ?? "");
  const setDock = useAtomSet(spaceDockAtom);
  if (post.spaceId === undefined) return null;
  const phase = space === undefined ? null : spacePhase(space);
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    forgetSpaceRead(post.spaceId!);
    setDock(post.spaceId!);
  };
  const faces = space?.people.slice(0, 3) ?? [];
  return (
    <button
      type="button"
      data-x="space-card"
      data-space-id={post.spaceId}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-1.5 rounded-2xl px-4 py-3 text-left transition-[filter] duration-150 hover:brightness-110",
        phase === "live" ? "text-white" : "border border-white/[0.12] bg-white/[0.03]",
      )}
      style={phase === "live" ? { background: SPACE_PURPLE } : undefined}
      onClick={open}
    >
      <span className="flex items-center gap-2 text-[13px] font-bold">
        {phase === "live" ? (
          <span className="tracking-wide">LIVE</span>
        ) : phase === "scheduled" && space?.scheduledStart != null ? (
          <span className="text-[#71767b]">Starts {xAge(space.scheduledStart)}</span>
        ) : phase === null ? (
          <span className="text-[#71767b]">Space</span>
        ) : (
          <span className="text-[#71767b]">
            {phase === "recorded" ? "Recorded" : "Ended"}
            {space?.endedAt == null ? "" : ` · ${xAge(space.endedAt)}`}
          </span>
        )}
        {space?.community == null ? null : (
          <span className="truncate font-normal opacity-80">{space.community.name}</span>
        )}
      </span>
      <span className="line-clamp-2 text-[17px] leading-6 font-bold">
        {space?.title || "Open this Space"}
      </span>
      {space === undefined ? null : (
        <span className="flex items-center gap-2 text-[13px]">
          <span className="flex -space-x-1.5">
            {faces.map((p) => (
              <Avatar key={p.handle} url={p.avatarUrl} size={20} />
            ))}
          </span>
          {phase === "live" && space.listening !== null
            ? `${fmt(space.listening)} listening`
            : phase === "recorded" && space.replays !== null
              ? `${fmt(space.replays)} plays`
              : (space.people[0]?.name ?? "")}
        </span>
      )}
    </button>
  );
}
